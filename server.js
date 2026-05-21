import "dotenv/config.js";
import app from "./src/app.js";
import database from "./src/config/database.js";
import SchedulerService from "./src/services/schedulerService.js";
import logger from "./src/utils/logger.js";
import {
  validateEnvironment,
  getEnvironmentSummary,
} from "./src/utils/envValidator.js";

const PORT = process.env.PORT || 3000;
let server; // Declare at module scope for graceful shutdown

// Graceful shutdown function
const gracefulShutdown = async () => {
  logger.info("Received shutdown signal, closing gracefully...");

  SchedulerService.stopAll();

  await database.disconnect();

  if (server) {
    server.close(() => {
      logger.info("Server closed");
      process.exit(0);
    });
  }

  // Force close after 10 seconds
  setTimeout(() => {
    logger.error(
      "Could not close connections in time, forcefully shutting down",
    );
    process.exit(1);
  }, 10000);
};

// Start server
const startServer = async () => {
  try {
    console.log("🔧 Starting MamaCheck backend...");
    
    // Validate environment variables first
    validateEnvironment();
    logger.info("Configuration:", getEnvironmentSummary());
    console.log("✅ Environment validated");

    console.log("🔌 Connecting to database...");
    await database.connect();
    console.log("✅ Database connected");

    server = app.listen(PORT, () => {
      logger.info(`🚀 MamaCheck backend running on port ${PORT}`);
      logger.info(`📡 Environment: ${process.env.NODE_ENV || "development"}`);
      logger.info(
        `💾 Database: ${database.isConnected ? "connected" : "disconnected"}`,
      );
      console.log(`\n🚀 Server is running on http://localhost:${PORT}\n`);
    });

    // Start all schedulers
    console.log("⏰ Starting schedulers...");
    SchedulerService.startAll();
    console.log("✅ Schedulers started");

    // Handle shutdown signals
    process.on("SIGTERM", gracefulShutdown);
    process.on("SIGINT", gracefulShutdown);

    return server;
  } catch (error) {
    console.error("❌ Failed to start server:", error.message);
    console.error(error.stack);
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  gracefulShutdown();
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  gracefulShutdown();
});

await startServer();

export default app;
