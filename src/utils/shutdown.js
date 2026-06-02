export const gracefulShutdown = async (server) => {
  logger.info("Received shutdown signal, starting graceful shutdown...");

  // Stop accepting new requests
  server.close(async () => {
    logger.info("HTTP server closed");

    // Close database connections
    await mongoose.disconnect();
    logger.info("Database disconnected");

    // Close Redis connection
    await redis.quit();
    logger.info("Redis disconnected");

    // Stop cron jobs
    missedVisitTracker.isRunning = false;
    reminderScheduler.isRunning = false;
    weeklyCheckinScheduler.isRunning = false;

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
