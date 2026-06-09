import mongoose from "mongoose";
import logger from "../utils/logger.js";

class Database {
  isConnected = false;
  connectionPromise = null;
  maxRetries = 5;
  baseRetryDelay = 5000;

  async connect(retryCount = 0) {
    if (this.isConnected && mongoose.connection.readyState === 1) {
      logger.debug("Database already connected");
      return mongoose.connection;
    }

    // Coalesce simultaneous calls onto a single in-flight attempt
    if (this.connectionPromise) {
      logger.debug("Waiting for existing connection attempt");
      return this.connectionPromise;
    }

    this.connectionPromise = this._doConnect(retryCount).finally(() => {
      this.connectionPromise = null;
    });

    return this.connectionPromise;
  }

  async _doConnect(retryCount) {
    const mongoURI =
      process.env.MONGODB_URI || "mongodb://localhost:27017/mamacheck";

    const poolSize = Number.parseInt(process.env.MONGODB_POOL_SIZE) || 10;
    const socketTimeout =
      Number.parseInt(process.env.MONGODB_SOCKET_TIMEOUT) || 45000;

    const options = {
      maxPoolSize: poolSize,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: socketTimeout,
      connectTimeoutMS: 15000,
      retryWrites: true,
      retryReads: true,
      heartbeatFrequencyMS: 10000,
    };

    if (
      process.env.NODE_ENV === "production" &&
      process.env.MONGODB_SSL === "true"
    ) {
      options.tls = true;
      options.tlsAllowInvalidCertificates = false;
    }

    try {
      await mongoose.connect(mongoURI, options);
      this.isConnected = true;
      this.setupEventHandlers();
      logger.info(`MongoDB connected successfully (pool size: ${poolSize})`);
      return mongoose.connection;
    } catch (error) {
      logger.error(
        `Database connection failed (attempt ${retryCount + 1}):`,
        error,
      );

      if (
        process.env.NODE_ENV === "production" &&
        retryCount < this.maxRetries
      ) {
        // Exponential backoff capped at 30s
        const delay = Math.min(this.baseRetryDelay * 2 ** retryCount, 30000);
        logger.warn(
          `Retrying connection (${retryCount + 1}/${this.maxRetries}) in ${delay}ms...`,
        );
        await this._delay(delay);
        // Re-enter connect() so the connectionPromise guard is fresh
        this.connectionPromise = null;
        return this.connect(retryCount + 1);
      }

      throw error;
    }
  }

  setupEventHandlers() {
    // Safely remove only our known listeners by using named handlers stored on the instance.
    // Avoid removeAllListeners() — it strips external listeners (e.g. test harness, APM agents).
    if (this._handlersAttached) return;
    this._handlersAttached = true;

    mongoose.connection.on("error", (error) => {
      logger.error("MongoDB connection error:", error);
      this.isConnected = false;
    });

    mongoose.connection.on("disconnected", () => {
      logger.warn("MongoDB disconnected");
      this.isConnected = false;

      if (process.env.NODE_ENV === "production") {
        logger.info("Attempting to reconnect...");
        setTimeout(() => this.connect(), 5000);
      }
    });

    mongoose.connection.on("reconnected", () => {
      logger.info("MongoDB reconnected");
      this.isConnected = true;
    });
  }

  async disconnect() {
    if (!this.isConnected && mongoose.connection.readyState === 0) return;

    logger.info("Disconnecting from MongoDB...");
    await mongoose.disconnect();
    this.isConnected = false;
    this.connectionPromise = null;
    this._handlersAttached = false;
    logger.info("MongoDB disconnected");
  }

  getConnection() {
    if (!this.isConnected || mongoose.connection.readyState !== 1) {
      throw new Error("Database not connected. Call connect() first.");
    }
    return mongoose.connection;
  }

  getHealth() {
    const conn = mongoose.connection;
    // Mongoose 7+/8+: pool info lives on the native client
    let poolSize = null;
    try {
      poolSize = conn.getClient()?.options?.maxPoolSize ?? null;
    } catch {
      // getClient() throws if never connected — swallow it
    }

    return {
      connected: this.isConnected && conn.readyState === 1,
      readyState: conn.readyState,
      poolSize,
    };
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

const db = new Database();

// Graceful shutdown
const shutdown = async (signal) => {
  try {
    await db.disconnect();
  } catch {
    // Already logged inside disconnect()
  }
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

export default db;
