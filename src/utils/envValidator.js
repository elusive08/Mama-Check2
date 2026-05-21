import logger from "./logger.js";

const requiredEnvVars = [
  "MONGODB_URI",
  "JWT_SECRET",
  "TERMII_API_KEY",
  "GROQ_API_KEY",
];

const optionalEnvVars = [
  "REDIS_URL",
  "SLACK_WEBHOOK_URL",
  "FRONTEND_URL",
  "CORS_ORIGIN",
];

/**
 * Validate that all required environment variables are set
 * @throws {Error} If required environment variables are missing
 */
export const validateEnvironment = () => {
  const missing = [];
  const warnings = [];

  // Check required variables
  requiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  });

  // Check optional variables in production
  if (process.env.NODE_ENV === "production") {
    optionalEnvVars.forEach((varName) => {
      if (!process.env[varName]) {
        warnings.push(varName);
      }
    });

    // Warn if JWT_SECRET is too short
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
      warnings.push("JWT_SECRET should be at least 32 characters long");
    }
  }

  // Throw error if required variables are missing
  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(", ")}`;
    logger.error(message);
    throw new Error(message);
  }

  // Log warnings for optional variables in production
  if (warnings.length > 0) {
    logger.warn(
      `Optional environment variables not set: ${warnings.join(", ")}`,
    );
  }

  logger.info("Environment validation passed");
};

/**
 * Get environment summary (safe to log)
 */
export const getEnvironmentSummary = () => {
  return {
    nodeEnv: process.env.NODE_ENV || "development",
    port: process.env.PORT || 3000,
    mongodbUri: process.env.MONGODB_URI ? "***" : "not set",
    jwtSecret: process.env.JWT_SECRET ? "***" : "not set",
    redisUrl: process.env.REDIS_URL ? "***" : "not set",
    logLevel: process.env.LOG_LEVEL || "info",
  };
};
