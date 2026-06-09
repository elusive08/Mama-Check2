import dotenv from "dotenv";

// Load test environment variables if in test mode
if (process.env.NODE_ENV === "test") {
  dotenv.config({ path: ".env.test" });
}

const requiredEnvVars = [
  "MONGODB_URI",
  "JWT_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
  "GROQ_API_KEY",
  "NODE_ENV",
  "LOG_LEVEL",
  "SMS_PROVIDER",
];

const optionalEnvVars = [
  "PORT",
  "REDIS_URL",
  "SLACK_WEBHOOK_URL",
  "FRONTEND_URL",
  "CORS_ORIGIN",
  "JWT_EXPIRY",
  "SEED_ADMIN_PASSWORD",
  "SEED_CHEW_PASSWORD",
];

/**
 * Validate that all required environment variables are set
 * @throws {Error} If required environment variables are missing
 */
export const validateEnvironment = () => {
  const missing = [];
  const warnings = [];
  const errors = [];

  // Check required variables
  requiredEnvVars.forEach((varName) => {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  });

  // Validate NODE_ENV is valid
  const validNodeEnvs = ["development", "production", "test"];
  if (process.env.NODE_ENV && !validNodeEnvs.includes(process.env.NODE_ENV)) {
    errors.push(`NODE_ENV must be one of: ${validNodeEnvs.join(", ")}`);
  }

  // Validate PORT is numeric
  if (process.env.PORT && Number.isNaN(Number.parseInt(process.env.PORT))) {
    errors.push("PORT must be a valid number");
  }

  // Validate LOG_LEVEL
  const validLogLevels = ["debug", "info", "warn", "error"];
  if (
    process.env.LOG_LEVEL &&
    !validLogLevels.includes(process.env.LOG_LEVEL)
  ) {
    warnings.push(`LOG_LEVEL should be one of: ${validLogLevels.join(", ")}`);
  }

  // Check optional variables in production
  if (process.env.NODE_ENV === "production") {
    optionalEnvVars.forEach((varName) => {
      if (!process.env[varName]) {
        warnings.push(varName);
      }
    });
  }

  // Warn if JWT_SECRET is too short (warn only, don't throw — allows short secrets in test env)
  if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
    warnings.push(
      "JWT_SECRET should be at least 32 characters long for security",
    );
  }

  // Throw error if required variables are missing
  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.join(", ")}`;
    console.error(message);
    throw new Error(message);
  }

  // Throw error for format/validation issues
  if (errors.length > 0) {
    const message = `Invalid environment configuration: ${errors.join("; ")}`;
    console.error(message);
    throw new Error(message);
  }

  // Log warnings for optional variables in production
  if (warnings.length > 0) {
    console.warn(
      `Optional environment variables not set: ${warnings.join(", ")}`,
    );
  }

  console.info("Environment validation passed");
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
