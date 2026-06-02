import mongoose from "mongoose";
import logger from "../utils/logger.js";

class Database {
  async connect() {
    if (this.isConnected) {
      logger.debug("Database already connected");
      return;
    }

    try {
      const mongoURI =
        process.env.MONGODB_URI || "mongodb://localhost:27017/mamacheck";

      await mongoose.connect(mongoURI, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 15000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 15000,
        retryWrites: true,
      });

      this.isConnected = true;

      mongoose.connection.on("error", (error) => {
        logger.error("MongoDB connection error:", error);
        this.isConnected = false;
      });

      mongoose.connection.on("disconnected", () => {
        logger.warn("MongoDB disconnected");
        this.isConnected = false;
      });

      logger.info("MongoDB connected successfully");
    } catch (error) {
      logger.error("Database connection failed:", error);
      throw error;
    }
  }

  async disconnect() {
    if (!this.isConnected) return;

    await mongoose.disconnect();
    this.isConnected = false;
    logger.info("MongoDB disconnected");
  }

  getConnection() {
    return mongoose.connection;
  }
  isConnected = false;
}

export default new Database();
