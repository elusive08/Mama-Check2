import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on("connect", () => {
  console.info("Redis connected successfully");
});

redis.on("error", (error) => {
  console.error("Redis connection error:", error);
});

redis.on("close", () => {
  console.warn("Redis connection closed");
});

export default redis;
