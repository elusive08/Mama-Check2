import database from "./database.js";
import twilio from "./twilio.js";
import groq from "./groq.js";

// Validate critical environment variables at startup
const validateEnvironmentVariables = () => {
  const required = [
    "JWT_SECRET",
    "MONGODB_URI",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_PHONE_NUMBER",
    "GROQ_API_KEY",
    "FRONTEND_URL",
    "WEBHOOK_BASE_URL",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `FATAL: Missing required environment variables: ${missing.join(", ")}`,
    );
  }

  // JWT_SECRET must be at least 32 bytes
  if (process.env.JWT_SECRET.length < 32) {
    throw new Error(
      "FATAL: JWT_SECRET must be at least 32 characters long for security",
    );
  }
};

// Run validation
try {
  validateEnvironmentVariables();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

export default {
  database,
  twilio,
  groq,
  app: {
    name: "MamaCheck",
    env: process.env.NODE_ENV || "development",
    port: process.env.PORT || 3000,
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
    queueProcessInterval: 30000, // 30 seconds
  },
};
