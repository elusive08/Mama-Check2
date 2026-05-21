import rateLimit from "express-rate-limit";
import Redis from "ioredis";
import logger from "../utils/logger.js";

let redisClient = null;

try {
  if (process.env.REDIS_URL) {
    redisClient = new Redis(process.env.REDIS_URL, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: null,
    });

    redisClient.on("error", (error) => {
      logger.warn("Redis rate limiter unavailable, using memory store", {
        error: error.message,
      });
      redisClient = null;
    });
  }
} catch (error) {
  logger.warn("Redis not available, using memory store for rate limiting", {
    error: error.message,
  });
}

// Helper to check if we're in test environment
const isTestEnvironment = () => process.env.NODE_ENV === "test";

// Create a no-op middleware for test environment
const noopLimiter = (req, res, next) => next();

// General API rate limiter
const generalLimiter = isTestEnvironment()
  ? noopLimiter
  : rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // 100 requests per window
      message: "Too many requests, please try again later.",
      standardHeaders: true,
      legacyHeaders: false,
    });

// Stricter limiter for registration
const registrationLimiter = isTestEnvironment()
  ? noopLimiter
  : rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 20, // 20 registrations per hour per IP
      message: "Too many registration attempts, please try again later.",
    });

// SMS webhook limiter (allows more, but still protected)
const webhookLimiter = isTestEnvironment()
  ? noopLimiter
  : rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 60, // 60 requests per minute
      message: "Too many webhook requests",
    });

// Dashboard API limiter for CHEWs
const dashboardLimiter = isTestEnvironment()
  ? noopLimiter
  : rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      message: "Too many dashboard requests",
    });

export {
  generalLimiter,
  registrationLimiter,
  webhookLimiter,
  dashboardLimiter,
};
