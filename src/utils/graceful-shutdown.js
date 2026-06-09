import database from "../config/database.js";
import redis from "../config/redis.js";

export const setupGracefulShutdown = (server) => {
  const shutdown = async (signal) => {
    console.info(`${signal} received. Starting graceful shutdown...`);

    // Set timeout to force shutdown after 30 seconds
    const timeout = setTimeout(() => {
      console.error("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 30000);

    try {
      // Stop accepting new requests
      if (server) {
        server.close(() => {
          console.info("HTTP server closed");
        });
      }

      // Close database connections
      await database.disconnect();
      console.info("Database disconnected");

      // Close Redis connection
      await redis.quit();
      console.info("Redis disconnected");

      // Clear timeout
      clearTimeout(timeout);

      console.info("Graceful shutdown completed");
      process.exit(0);
    } catch (error) {
      console.error("Error during graceful shutdown:", error);
      process.exit(1);
    }
  };

  // Handle various termination signals
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    console.error("Uncaught Exception:", error);
    shutdown("UNCAUGHT_EXCEPTION");
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
    shutdown("UNHANDLED_REJECTION");
  });
};
