import Redis from "ioredis";

/**
 * Key prefix for namespacing — prevents collisions when multiple
 * environments (dev, staging, prod) share a Redis instance.
 * Set REDIS_KEY_PREFIX in env (e.g. "mamacheck:prod:").
 */
// KEY_PREFIX: empty in test (so tests can read keys directly), namespaced otherwise.
// Override with REDIS_KEY_PREFIX env var in any environment.
function getKeyPrefix() {
  // ✅ Extract nested ternary into independent statement
  if (process.env.REDIS_KEY_PREFIX !== undefined) {
    return process.env.REDIS_KEY_PREFIX;
  }
  if (process.env.NODE_ENV === "test") {
    return "";
  }
  return "mamacheck:";
}

const KEY_PREFIX = getKeyPrefix();

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
    // ✅ In test environment or if REDIS_URL is "mock", use in-memory mock
    if (process.env.NODE_ENV === "test" || process.env.REDIS_URL === "mock") {
      console.info("Redis: Using in-memory mock store (test environment)");
      this._initMockStore();
      return;
    }

    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    const isProduction = process.env.NODE_ENV === "production";

    const options = {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > this.maxRetries) {
          console.error(`Redis: Max retries (${this.maxRetries}) reached`);
          // ✅ In test, fall back to mock instead of failing
          if (process.env.NODE_ENV === "test") {
            console.info("Redis: Falling back to in-memory mock store");
            this._initMockStore();
          }
          return null; // Stop retrying
        }
        // Exponential backoff capped at 3s
        const delay = Math.min(100 * 2 ** (times - 1), 3000);
        console.warn(
          `Redis: Retry attempt ${times}/${this.maxRetries} in ${delay}ms`,
        );
        this.retryCount = times;
        return delay;
      },
      enableReadyCheck: true,
      lazyConnect: false,
      connectTimeout: 10000,
      commandTimeout: 5000,
      keepAlive: 30000,
      // ✅ Try IPv4 first, fallback to auto if it fails
      family: 4,
      db: Number.parseInt(process.env.REDIS_DB) || 0,
      password: process.env.REDIS_PASSWORD || undefined,
      tls:
        isProduction && process.env.REDIS_TLS === "true"
          ? {
              rejectUnauthorized:
                process.env.REDIS_TLS_REJECT_UNAUTHORIZED !== "false",
              servername: process.env.REDIS_TLS_SERVERNAME,
            }
          : undefined,
    };

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

    // ✅ Handle initial connection errors
    this.client.once("error", (error) => {
      if (process.env.NODE_ENV === "test") {
        console.warn("Redis: Connection failed in test, using mock store");
        this._initMockStore();
      }
    });
  }

  _initMockStore() {
    this.mockStore = new Map();
    this.isReady = true;
    this.useMock = true;
    this.client = {
      status: "ready",
      get: async (key) => {
        const item = this.mockStore.get(key);
        if (!item) return null;
        if (item.expiry && Date.now() > item.expiry) {
          this.mockStore.delete(key);
          return null;
        }
        return item.value;
      },
      set: async (key, value) => {
        this.mockStore.set(key, { value, expiry: null });
        return "OK";
      },
      setex: async (key, seconds, value) => {
        this.mockStore.set(key, {
          value,
          expiry: Date.now() + seconds * 1000,
        });
        return "OK";
      },
      setnx: async (key, value) => {
        if (this.mockStore.has(key)) return 0;
        this.mockStore.set(key, { value, expiry: null });
        return 1;
      },
      del: async (key) => {
        this.mockStore.delete(key);
        return 1;
      },
      exists: async (key) => {
        const item = this.mockStore.get(key);
        if (!item) return 0;
        if (item.expiry && Date.now() > item.expiry) {
          this.mockStore.delete(key);
          return 0;
        }
        return 1;
      },
      ttl: async (key) => {
        const item = this.mockStore.get(key);
        if (!item?.expiry) return -1;
        const remaining = Math.floor((item.expiry - Date.now()) / 1000);
        return remaining > 0 ? remaining : -2;
      },
      quit: async () => {
        this.mockStore.clear();
        return "OK";
      },
      on: () => {},
      once: () => {},
    };
    console.info("✅ Redis mock store initialized");
  }

  _setupEventHandlers() {
    if (this.useMock) return;

    this.client.on("connect", () => {
      console.info("Redis: Connecting...");
    });

    this.client.on("ready", () => {
      this.isReady = true;
      this.retryCount = 0;
      this._readyPromise = null;
      console.info("✅ Redis connected successfully");
    });

    this.client.on("error", (error) => {
      console.error("❌ Redis connection error:", error.message);
      this.isReady = false;

      if (process.env.NODE_ENV === "test") {
        console.warn("Redis: Connection failed in test, using mock store");
        this._initMockStore();
        return;
      }

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
    if (this.useMock) {
      return this.client;
    }

    if (this.isReady && this.client.status === "ready") {
      return this.client;
    }

    if (!this._readyPromise) {
      this._readyPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this._readyPromise = null;
          // ✅ In test, fall back to mock on timeout
          if (process.env.NODE_ENV === "test") {
            console.warn("Redis: Connection timeout in test, using mock store");
            this._initMockStore();
            resolve(this.client);
          } else {
            reject(new Error("Redis connection timeout after 10 seconds"));
          }
        }, 10000);

        const onReady = () => {
          clearTimeout(timeout);
          this._readyPromise = null;
          resolve(this.client);
        };
        const onError = (error) => {
          clearTimeout(timeout);
          this._readyPromise = null;
          // ✅ In test, fall back to mock on error
          if (process.env.NODE_ENV === "test") {
            console.warn("Redis: Connection error in test, using mock store");
            this._initMockStore();
            resolve(this.client);
          } else {
            reject(error);
          }
        };

        this.client.once("ready", onReady);
        this.client.once("error", onError);
      });
    }

    return this._readyPromise;
  }

  async quit() {
    if (this.useMock) {
      this.mockStore.clear();
      console.info("Redis mock disconnected");
      return;
    }
    if (this.client) {
      await this.client.quit();
      this.isReady = false;
      console.info("Redis disconnected gracefully");
    }
  }

  getHealth() {
    if (this.useMock) {
      return { connected: true, status: "mock", retryCount: 0 };
    }
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
    if (this.useMock) {
      const item = this.mockStore.get(key);
      if (!item) return null;
      if (item.expiry && Date.now() > item.expiry) {
        this.mockStore.delete(key);
        return null;
      }
      return item.value;
    }
    try {
      const client = await this.getConnection();
      return await client.get(this._key(key));
    } catch (error) {
      console.error(`Redis GET error for key "${key}":`, error.message);
      // ✅ In test, fall back to mock
      if (process.env.NODE_ENV === "test") {
        return this.get(key);
      }
      return null;
    }
  }

  async set(key, value, ttlSeconds = null) {
    if (this.useMock) {
      this.mockStore.set(key, {
        value,
        expiry: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      });
      return "OK";
    }
    try {
      const client = await this.getConnection();
      const k = this._key(key);
      const ttl =
        typeof ttlSeconds === "number" && ttlSeconds > 0 ? ttlSeconds : null;
      return ttl
        ? await client.set(k, value, "EX", ttl)
        : await client.set(k, value);
    } catch (error) {
      console.error(`Redis SET error for key "${key}":`, error.message);
      // ✅ In test, fall back to mock
      if (process.env.NODE_ENV === "test") {
        return this.set(key, value, ttlSeconds);
      }
      return null;
    }
  }

  async del(key) {
    if (this.useMock) {
      this.mockStore.delete(key);
      return 1;
    }
    try {
      const client = await this.getConnection();
      return await client.del(this._key(key));
    } catch (error) {
      console.error(`Redis DEL error for key "${key}":`, error.message);
      // ✅ In test, fall back to mock
      if (process.env.NODE_ENV === "test") {
        return this.del(key);
      }
      return 0;
    }
  }

  async exists(key) {
    if (this.useMock) {
      const item = this.mockStore.get(key);
      if (!item) return false;
      if (item.expiry && Date.now() > item.expiry) {
        this.mockStore.delete(key);
        return false;
      }
      return true;
    }
    try {
      const client = await this.getConnection();
      return (await client.exists(this._key(key))) === 1;
    } catch (error) {
      console.error(`Redis EXISTS error for key "${key}":`, error.message);
      // ✅ In test, fall back to mock
      if (process.env.NODE_ENV === "test") {
        return this.exists(key);
      }
      return false;
    }
  }

  async expire(key, ttlSeconds) {
    if (this.useMock) {
      const item = this.mockStore.get(key);
      if (item) {
        item.expiry = Date.now() + ttlSeconds * 1000;
      }
      return 1;
    }
    try {
      const client = await this.getConnection();
      return await client.expire(this._key(key), ttlSeconds);
    } catch (error) {
      console.error(`Redis EXPIRE error for key "${key}":`, error.message);
      // ✅ In test, fall back to mock
      if (process.env.NODE_ENV === "test") {
        return this.expire(key, ttlSeconds);
      }
      return 0;
    }
  }

  async ttl(key) {
    if (this.useMock) {
      const item = this.mockStore.get(key);
      if (!item?.expiry) return -1;
      const remaining = Math.floor((item.expiry - Date.now()) / 1000);
      return remaining > 0 ? remaining : -2;
    }
    try {
      const client = await this.getConnection();
      return await client.ttl(this._key(key));
    } catch (error) {
      console.error(`Redis TTL error for key "${key}":`, error.message);
      // ✅ In test, fall back to mock
      if (process.env.NODE_ENV === "test") {
        return this.ttl(key);
      }
      return -2;
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
    if (this.useMock) {
      if (this.mockStore.has(key)) return null;
      this.mockStore.set(key, {
        value,
        expiry: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      });
      return "OK";
    }
    try {
      const client = await this.getConnection();
      const k = this._key(key);
      if (ttlSeconds) {
        return await client.set(k, value, "EX", ttlSeconds, "NX");
      }
      return await client.setnx(k, value);
    } catch (error) {
      console.error(`Redis SETNX error for key "${key}":`, error.message);
      // ✅ In test, fall back to mock
      if (process.env.NODE_ENV === "test") {
        return this.setnx(key, value, ttlSeconds);
      }
      return null;
    }
  }
}

export default new RedisClient();
