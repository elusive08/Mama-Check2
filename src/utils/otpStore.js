import Redis from "ioredis";
import logger from "./logger.js";

class OTPStore {
  constructor() {
    this.fallbackMemory = new Map(); // Fallback if Redis unavailable
    this.useMemoryFallback = false;
    this.initRedis();
  }

  /**
   * Initialize Redis connection
   */
  initRedis() {
    if (!process.env.REDIS_URL) {
      logger.warn(
        "Redis not configured. Using in-memory OTP store (not recommended for production)",
      );
      this.useMemoryFallback = true;
      return;
    }

    try {
      this.redis = new Redis(process.env.REDIS_URL, {
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          logger.warn(`Redis connection failed, retrying in ${delay}ms...`);
          return delay;
        },
        maxRetriesPerRequest: null,
      });

      this.redis.on("error", (err) => {
        logger.error("Redis error:", err);
        this.useMemoryFallback = true;
      });

      this.redis.on("connect", () => {
        logger.info("Redis connected successfully");
        this.useMemoryFallback = false;
      });

      this.redis.on("close", () => {
        logger.warn("Redis connection closed");
        this.useMemoryFallback = true;
      });
    } catch (error) {
      logger.error("Failed to initialize Redis:", error);
      this.useMemoryFallback = true;
    }
  }

  /**
   * Store OTP with expiration
   */
  async set(key, value, ttlSeconds = 300) {
    try {
      if (this.redis && !this.useMemoryFallback) {
        await this.redis.setex(key, ttlSeconds, JSON.stringify(value));
      } else {
        this.fallbackMemory.set(key, {
          value,
          expiresAt: Date.now() + ttlSeconds * 1000,
        });
      }
    } catch (error) {
      logger.error("OTPStore set error:", error);
      // Fall back to memory
      this.fallbackMemory.set(key, {
        value,
        expiresAt: Date.now() + ttlSeconds * 1000,
      });
    }
  }

  /**
   * Retrieve OTP
   */
  async get(key) {
    try {
      if (this.redis && !this.useMemoryFallback) {
        const value = await this.redis.get(key);
        return value ? JSON.parse(value) : null;
      } else {
        const item = this.fallbackMemory.get(key);
        if (!item) return null;

        // Check if expired
        if (item.expiresAt && Date.now() > item.expiresAt) {
          this.fallbackMemory.delete(key);
          return null;
        }

        return item.value;
      }
    } catch (error) {
      logger.error("OTPStore get error:", error);
      return null;
    }
  }

  /**
   * Delete OTP
   */
  async delete(key) {
    try {
      if (this.redis && !this.useMemoryFallback) {
        await this.redis.del(key);
      } else {
        this.fallbackMemory.delete(key);
      }
    } catch (error) {
      logger.error("OTPStore delete error:", error);
    }
  }

  /**
   * Check if OTP exists
   */
  async exists(key) {
    try {
      if (this.redis && !this.useMemoryFallback) {
        const result = await this.redis.exists(key);
        return result === 1;
      } else {
        const item = this.fallbackMemory.get(key);
        if (!item) return false;

        if (item.expiresAt && Date.now() > item.expiresAt) {
          this.fallbackMemory.delete(key);
          return false;
        }

        return true;
      }
    } catch (error) {
      logger.error("OTPStore exists error:", error);
      return false;
    }
  }

  /**
   * Cleanup expired OTPs (only for memory fallback)
   */
  cleanupExpired() {
    if (this.useMemoryFallback) {
      const now = Date.now();
      for (const [key, item] of this.fallbackMemory.entries()) {
        if (item.expiresAt && now > item.expiresAt) {
          this.fallbackMemory.delete(key);
        }
      }
    }
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
  redis = null;
}

export default new OTPStore();
