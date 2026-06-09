import database from "./database.js";
import sms from "./sms.js"; // was incorrectly imported as './twilio.js'
import groqConfig from "./groq.js";
import redis from "./redis.js";

/**
 * Validate required environment variables at startup.
 * SMS provider validation is conditional on the configured provider.
 */
const validateEnvironmentVariables = () => {
  const smsProvider = process.env.SMS_PROVIDER || "bulksms";

  // Core vars always required
  const required = [
    "JWT_SECRET",
    "MONGODB_URI",
    "REDIS_URL",
    "GROQ_API_KEY",
    "FRONTEND_URL",
  ];

  // SMS provider-specific vars
  if (smsProvider === "twilio") {
    required.push(
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_PHONE_NUMBER",
    );
  } else {
    required.push("BULKSMS_API_KEY");
  }

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  if (process.env.JWT_SECRET.length < 32) {
    throw new Error(
      "FATAL: JWT_SECRET must be at least 32 characters long for security",
    );
  }
};

// Validate env vars before anything else — fail fast with a clear message
try {
  validateEnvironmentVariables();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

// Validate Groq config (deferred from class construction so we can exit cleanly here)
try {
  groqConfig.validateApiKey();
  const { valid, issues } = groqConfig.validate();
  if (!valid) {
    // Warn on non-fatal issues (missing key already caught above in prod)
    issues.forEach((issue) => console.warn(`Groq config warning: ${issue}`));
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

export default {
  database,
  sms,
  redis,
  groq: groqConfig.config,
  app: {
    name: "MamaCheck",
    env: process.env.NODE_ENV || "development",
    port: Number.parseInt(process.env.PORT) || 3000,
    version: "1.0.0",
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  },
  otp: {
    expiryMinutes: Number.parseInt(process.env.OTP_EXPIRY_MINUTES) || 5,
    length: 6,
  },
  scheduling: {
    reminderHour: 6, // 6 AM UTC (7 AM WAT)
    weeklyCheckinDay: 0, // Sunday
    queueProcessInterval: 30000,
  },
};
