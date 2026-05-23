import database from "./database.js";
import twilio from "./twilio.js";
import groq from "./groq.js";

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
