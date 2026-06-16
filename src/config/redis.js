import Redis from "ioredis";

/**
 * Key prefix for namespacing — prevents collisions when multiple
 * environments (dev, staging, prod) share a Redis instance.
 * Set REDIS_KEY_PREFIX in env (e.g. "mamacheck:prod:").
 */
// KEY_PREFIX: empty in test (so tests can read keys directly), namespaced otherwise.
// Override with REDIS_KEY_PREFIX env var in any environment.
const KEY_PREFIX =
  process.env.REDIS_KEY_PREFIX !== undefined
    ? process.env.REDIS_KEY_PREFIX
    : process.env.NODE_ENV === "test"
      ? ""
      : "mamacheck:";

class RedisClient {
  client = null;
  isReady = false;
  retryCount = 0;
  maxRetries = 5;
  // connectionPromise is only used for the initial ready-wait; cleared on success
  _readyPromise = null;

  constructor() {
    this._initialize();
  }

  _initialize() {
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    const isProduction = process.env.NODE_ENV === "production";

    const options = {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > this.maxRetries) {
          console.error(`Redis: Max retries (${this.maxRetries}) reached`);
          return null; // Stop retrying
        }
        const delay = Math.min(100 * 2 ** (times - 1), 3000);
        console.warn(`Redis: Retry attempt ${times}/${this.maxRetries} in ${delay}ms`);
        this.retryCount = times;
        return delay;
      },
      enableReadyCheck: true,
      lazyConnect: false,
      connectTimeout: 15000,
      commandTimeout: 5000,
      keepAlive: 30000,
      family: 4,
    };

    // If using rediss:// protocol, ioredis handles TLS automatically.
    // Only add explicit TLS options if protocol is NOT rediss and TLS is requested.
    if (process.env.NODE_ENV === "production" && process.env.REDIS_TLS === "true" && !redisUrl.startsWith("rediss://")) {
      options.tls = {
        rejectUnauthorized: process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false",
        servername: process.env.REDIS_TLS_SERVERNAME,
      };
    }

    if (process.env.REDIS_SENTINELS) {
      try {
        options.sentinels = JSON.parse(process.env.REDIS_SENTINELS);
        options.name = process.env.REDIS_SENTINEL_NAME;
        options.sentinelPassword = process.env.REDIS_SENTINEL_PASSWORD;
      } catch {
        console.error(
          "Redis: Failed to parse REDIS_SENTINELS JSON — skipping sentinel config",
        );
      }
    }

    this.client = new Redis(redisUrl, options);
    this._setupEventHandlers();
  }

  _setupEventHandlers() {
    this.client.on("connect", () => {
      console.info("Redis: Connecting...");
    });

    this.client.on("ready", () => {
      this.isReady = true;
      this.retryCount = 0;
      this._readyPromise = null; // Clear stale promise — next call creates a fresh one if needed
      console.info("✅ Redis connected successfully");
    });

    this.client.on("error", (error) => {
      console.error("❌ Redis connection error:", error.message);
      this.isReady = false;

      if (
        process.env.NODE_ENV === "production" &&
        error.code === "ECONNREFUSED"
      ) {
        console.error(
          "Redis is unavailable. OTP and session features may degrade.",
        );
      }
    });

    this.client.on("close", () => {
      console.warn("⚠️ Redis connection closed");
      this.isReady = false;
    });

    this.client.on("reconnecting", () => {
      console.info("Redis: Reconnecting...");
    });
  }

  /**
   * Returns the Redis client, waiting for it to be ready if necessary.
   * Safe for concurrent callers — they all share one pending promise.
   */
  async getConnection() {
    if (this.isReady && this.client.status === "ready") {
      return this.client;
    }

    if (!this._readyPromise) {
      this._readyPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this._readyPromise = null;
          reject(new Error("Redis connection timeout after 10 seconds"));
        }, 10000);

        // Use `once` — avoid stacking listeners across concurrent callers
        const onReady = () => {
          clearTimeout(timeout);
          this._readyPromise = null;
          resolve(this.client);
        };
        const onError = (error) => {
          clearTimeout(timeout);
          this._readyPromise = null;
          reject(error);
        };

        this.client.once("ready", onReady);
        this.client.once("error", onError);
      });
    }

    return this._readyPromise;
  }

  async quit() {
    if (this.client) {
      await this.client.quit();
      this.isReady = false;
      console.info("Redis disconnected gracefully");
    }
  }

  getHealth() {
    return {
      connected: this.isReady && this.client?.status === "ready",
      status: this.client?.status ?? "unknown",
      retryCount: this.retryCount,
    };
  }

  // ─── Namespaced key helper ───────────────────────────────────────────────

  _key(key) {
    return `${KEY_PREFIX}${key}`;
  }

  // ─── Core helpers ────────────────────────────────────────────────────────

  async get(key) {
    try {
      const client = await this.getConnection();
      return await client.get(this._key(key));
    } catch (error) {
      console.error(`Redis GET error for key "${key}":`, error.message);
      return null;
    }
  }

  async set(key, value, ttlSeconds = null) {
    try {
      const client = await this.getConnection();
      const k = this._key(key);
      // Guard: ttlSeconds must be a positive integer. If callers accidentally
      // pass "EX" (old ioredis positional style) treat it as no TTL.
      const ttl =
        typeof ttlSeconds === "number" && ttlSeconds > 0 ? ttlSeconds : null;
      return ttl
        ? await client.set(k, value, "EX", ttl)
        : await client.set(k, value);
    } catch (error) {
      console.error(`Redis SET error for key "${key}":`, error.message);
      return null;
    }
  }

  async del(key) {
    try {
      const client = await this.getConnection();
      return await client.del(this._key(key));
    } catch (error) {
      console.error(`Redis DEL error for key "${key}":`, error.message);
      return 0;
    }
  }

  async exists(key) {
    try {
      const client = await this.getConnection();
      return (await client.exists(this._key(key))) === 1;
    } catch (error) {
      console.error(`Redis EXISTS error for key "${key}":`, error.message);
      return false;
    }
  }

  async expire(key, ttlSeconds) {
    try {
      const client = await this.getConnection();
      return await client.expire(this._key(key), ttlSeconds);
    } catch (error) {
      console.error(`Redis EXPIRE error for key "${key}":`, error.message);
      return 0;
    }
  }

  async ttl(key) {
    try {
      const client = await this.getConnection();
      return await client.ttl(this._key(key));
    } catch (error) {
      console.error(`Redis TTL error for key "${key}":`, error.message);
      return -2; // -2 = key does not exist
    }
  }

  /**
   * Set a key with a mandatory TTL (seconds). Alias for set(key, value, ttl)
   * provided for compatibility with callers that use the Redis SETEX convention.
   */
  async setex(key, ttlSeconds, value) {
    return this.set(key, value, ttlSeconds);
  }

  /** Atomically set a value only if the key does not already exist. */
  async setnx(key, value, ttlSeconds = null) {
    try {
      const client = await this.getConnection();
      const k = this._key(key);
      if (ttlSeconds) {
        return await client.set(k, value, "EX", ttlSeconds, "NX");
      }
      return await client.setnx(k, value);
    } catch (error) {
      console.error(`Redis SETNX error for key "${key}":`, error.message);
      return null;
    }
  }
}

export default new RedisClient();
