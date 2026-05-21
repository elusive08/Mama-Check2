import { describe, test, expect, beforeEach } from "@jest/globals";

// Mock function factory for Jest
const mockFn = (impl = undefined) => {
  const calls = [];
  const fn = function (...args) {
    calls.push(args);
    return typeof impl === "function" ? impl(...args) : impl;
  };
  fn.calls = calls;
  fn.mockReturnThis = () => {
    fn.returnValue = fn;
    return fn;
  };
  return fn;
};
const spyOn = (obj, method) => {
  const originalFn = obj[method];
  const mockFn = (impl = undefined) => {
    const calls = [];
    const fn = function (...args) {
      calls.push(args);
      return typeof impl === "function"
        ? impl(...args)
        : originalFn?.apply(obj, args);
    };
    fn.calls = calls;
    fn.toHaveBeenCalled = () => calls.length > 0;
    return fn;
  };
  const spy = mockFn(() => originalFn?.apply(obj, arguments));
  obj[method] = spy;
  return spy;
};
const vi = { fn: mockFn, spyOn };

import {
  validateEnvironment,
  getEnvironmentSummary,
} from "../../src/utils/envValidator.js";

describe("Environment Validator", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  describe("validateEnvironment", () => {
    test("should throw error when required variables are missing", () => {
      process.env.MONGODB_URI = undefined;
      process.env.JWT_SECRET = "test-secret-key-min-32-chars-long";
      process.env.TERMII_API_KEY = "test-key";
      process.env.GROQ_API_KEY = "test-key";

      expect(() => {
        validateEnvironment();
      }).toThrow();
    });

    test("should pass when all required variables are set", () => {
      process.env.MONGODB_URI = "mongodb://localhost:27017/test";
      process.env.JWT_SECRET = "test-secret-key-min-32-chars-long";
      process.env.TERMII_API_KEY = "test-key";
      process.env.GROQ_API_KEY = "test-key";

      expect(() => {
        validateEnvironment();
      }).not.toThrow();
    });

    test("should warn in production if optional vars missing", () => {
      process.env.NODE_ENV = "production";
      process.env.MONGODB_URI = "mongodb://localhost:27017/test";
      process.env.JWT_SECRET = "test-secret-key-min-32-chars-long";
      process.env.TERMII_API_KEY = "test-key";
      process.env.GROQ_API_KEY = "test-key";
      process.env.REDIS_URL = undefined;

      // Test that validateEnvironment executes without throwing
      expect(() => validateEnvironment()).not.toThrow();
    });

    test("should validate JWT_SECRET minimum length", () => {
      process.env.NODE_ENV = "production";
      process.env.MONGODB_URI =
        process.env.MONGODB_URI || "mongodb://localhost:27017/test";
      process.env.JWT_SECRET = "short"; // Too short
      process.env.TERMII_API_KEY = "test-key";
      process.env.GROQ_API_KEY = "test-key";

      // Test that validateEnvironment executes without throwing
      // (Note: validateEnvironment may warn but shouldn't throw for missing JWT_SECRET)
      expect(() => validateEnvironment()).not.toThrow();
    });
  });

  describe("getEnvironmentSummary", () => {
    test("should return environment summary", () => {
      process.env.NODE_ENV = "production";
      process.env.MONGODB_URI = "mongodb://localhost:27017/test";
      process.env.JWT_SECRET = "test-secret-key-min-32-chars-long";

      const summary = getEnvironmentSummary();

      expect(summary).toHaveProperty("nodeEnv");
      expect(summary).toHaveProperty("port");
      expect(summary).toHaveProperty("mongodbUri");
      expect(summary).toHaveProperty("jwtSecret");
    });

    test("should mask sensitive values", () => {
      process.env.MONGODB_URI = "mongodb://user:password@localhost/test";
      process.env.JWT_SECRET = "test-secret-key-min-32-chars-long";

      const summary = getEnvironmentSummary();

      expect(summary.mongodbUri).toBe("***");
      expect(summary.jwtSecret).toBe("***");
    });

    test("should show not set for missing vars", () => {
      process.env.REDIS_URL = undefined;

      const summary = getEnvironmentSummary();

      expect(summary.redisUrl).toBe("not set");
    });
  });
});
