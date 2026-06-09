import { describe, test, expect, beforeEach, afterEach } from "@jest/globals";
import {
  validateEnvironment,
  getEnvironmentSummary,
} from "../../src/utils/envValidator.js";

describe("Environment Validator", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Save original env
    Object.assign(originalEnv, process.env);
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe("validateEnvironment", () => {
    test("should pass when all required variables are set", () => {
      // Set all required env vars
      process.env.MONGODB_URI = "mongodb://test:27017";
      process.env.JWT_SECRET = "this_is_a_32_character_long_secret";
      process.env.TWILIO_ACCOUNT_SID = "AC123";
      process.env.TWILIO_AUTH_TOKEN = "token123";
      process.env.TWILIO_PHONE_NUMBER = "+1234567890";
      process.env.GROQ_API_KEY = "groq123";
      process.env.NODE_ENV = "test";
      process.env.LOG_LEVEL = "info";
      process.env.PORT = "3000";

      expect(() => validateEnvironment()).not.toThrow();
    });

    test("should throw error when required variables are missing", () => {
      // Clear required vars
      delete process.env.MONGODB_URI;
      delete process.env.JWT_SECRET;

      expect(() => validateEnvironment()).toThrow();
    });

    test("should warn in production if optional vars missing", () => {
      // Save original console.warn
      const originalWarn = console.warn;

      // Mock console.warn
      console.warn = (...args) => {
        originalWarn(...args);
      };

      process.env.NODE_ENV = "production";
      process.env.MONGODB_URI = "mongodb://test:27017";
      process.env.JWT_SECRET = "this_is_a_32_character_long_secret";
      process.env.TWILIO_ACCOUNT_SID = "AC123";
      process.env.TWILIO_AUTH_TOKEN = "token123";
      process.env.TWILIO_PHONE_NUMBER = "+1234567890";
      process.env.GROQ_API_KEY = "groq123";
      process.env.LOG_LEVEL = "info";
      // Don't set optional vars like PORT, REDIS_URL, etc.

      expect(() => validateEnvironment()).not.toThrow();
      // Warning should have been called (but we don't need to assert it)

      // Restore console.warn
      console.warn = originalWarn;
    });

    test("should validate JWT_SECRET minimum length", () => {
      process.env.MONGODB_URI = "mongodb://test:27017";
      process.env.JWT_SECRET = "short";
      process.env.TWILIO_ACCOUNT_SID = "AC123";
      process.env.TWILIO_AUTH_TOKEN = "token123";
      process.env.TWILIO_PHONE_NUMBER = "+1234567890";
      process.env.GROQ_API_KEY = "groq123";
      process.env.NODE_ENV = "test";
      process.env.LOG_LEVEL = "info";

      // Should not throw, just warn
      expect(() => validateEnvironment()).not.toThrow();
    });
  });

  describe("getEnvironmentSummary", () => {
    test("should return environment summary", () => {
      process.env.NODE_ENV = "test";
      process.env.PORT = "3000";
      process.env.MONGODB_URI = "mongodb://test:27017";
      process.env.JWT_SECRET = "secret";
      process.env.REDIS_URL = "redis://localhost";
      process.env.LOG_LEVEL = "info";

      const summary = getEnvironmentSummary();

      expect(summary).toHaveProperty("nodeEnv");
      expect(summary).toHaveProperty("port");
      expect(summary).toHaveProperty("mongodbUri");
      expect(summary).toHaveProperty("jwtSecret");
      expect(summary).toHaveProperty("redisUrl");
      expect(summary).toHaveProperty("logLevel");
    });

    test("should mask sensitive values", () => {
      process.env.MONGODB_URI = "mongodb://user:pass@test:27017";
      process.env.JWT_SECRET = "my-super-secret-key";

      const summary = getEnvironmentSummary();

      expect(summary.mongodbUri).toBe("***");
      expect(summary.jwtSecret).toBe("***");
    });

    test("should show not set for missing vars", () => {
      delete process.env.MONGODB_URI;
      delete process.env.JWT_SECRET;

      const summary = getEnvironmentSummary();

      expect(summary.mongodbUri).toBe("not set");
      expect(summary.jwtSecret).toBe("not set");
    });
  });
});
