import mongoose from "mongoose";
import redis from "../config/redis.js";
import logger from "../utils/logger.js";
import missedVisitTracker from "../jobs/missedVisitTracker.js";
import reminderScheduler from "../jobs/reminderScheduler.js";
import weeklyCheckinScheduler from "../jobs/weeklyCheckinScheduler.js";

export const gracefulShutdown = async (server) => {
  logger.info("Received shutdown signal, starting graceful shutdown...");

  // Stop accepting new requests
  server.close(async () => {
    logger.info("HTTP server closed");

    // Close database connections
    await mongoose.disconnect();
    logger.info("Database disconnected");

    // Close Redis connection
    if (redis && redis.quit) {
      await redis.quit();
      logger.info("Redis disconnected");
    }

    // Stop cron jobs (if they exist and have isRunning flags)
    if (missedVisitTracker) missedVisitTracker.isRunning = false;
    if (reminderScheduler) reminderScheduler.isRunning = false;
    if (weeklyCheckinScheduler) weeklyCheckinScheduler.isRunning = false;

    logger.info("Graceful shutdown completed");
    process.exit(0);
  });

  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error(
      "Could not close connections in time, forcefully shutting down",
    );
    process.exit(1);
  }, 30000);
};
