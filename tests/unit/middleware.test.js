import { describe, test, expect } from "@jest/globals";
import { AppError } from "../../src/middleware/errorHandler.js";
import {
  requestIdMiddleware,
  requestLoggingMiddleware,
} from "../../src/middleware/requestTracking.js";

// Mock function factory for Jest
const mockFn = (impl = undefined) => {
  const calls = [];
  const fn = function (...args) {
    calls.push(args);
    return typeof impl === "function" ? impl(...args) : impl;
  };
  fn.calls = calls;
  fn.toHaveBeenCalled = () => calls.length > 0;
  fn.toHaveBeenCalledWith = (...expected) =>
    calls.some((c) => JSON.stringify(c) === JSON.stringify(expected));
  fn.mockReturnThis = () => {
    fn.returnValue = fn;
    return fn;
  };
  return fn;
};
const vi = { fn: mockFn };

describe("ErrorHandler and AppError", () => {
  describe("AppError", () => {
    test("should create AppError with message and status code", () => {
      const error = new AppError("Test error", 400, "LOW");

      expect(error.message).toBe("Test error");
      expect(error.statusCode).toBe(400);
      expect(error.severity).toBe("LOW");
      expect(error.isOperational).toBe(true);
    });

    test("should capture stack trace", () => {
      const error = new AppError("Test error", 500);

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain("middleware.test.js");
    });

    test("should default severity to MEDIUM", () => {
      const error = new AppError("Test error", 400);

      expect(error.severity).toBe("MEDIUM");
    });
  });

  describe("Request ID Middleware", () => {
    test("should generate request ID if not provided", () => {
      const req = { get: vi.fn(() => undefined) };
      const res = { setHeader: vi.fn() };
      const next = vi.fn();

      requestIdMiddleware(req, res, next);

      expect(req.id).toBeDefined();
      expect(typeof req.id).toBe("string");
      // Verify setHeader was called with correct arguments
      expect(res.setHeader.calls.length).toBeGreaterThan(0);
      expect(res.setHeader.calls[0]).toEqual(["X-Request-ID", req.id]);
      expect(next.calls.length).toBeGreaterThan(0);
    });

    test("should use existing request ID if provided", () => {
      const existingId = "existing-request-id-123";
      const req = { get: vi.fn(() => existingId) };
      const res = { setHeader: vi.fn() };
      const next = vi.fn();

      requestIdMiddleware(req, res, next);

      expect(req.id).toBe(existingId);
      // Verify setHeader was called with correct arguments
      expect(res.setHeader.calls.length).toBeGreaterThan(0);
      expect(res.setHeader.calls[0]).toEqual(["X-Request-ID", existingId]);
    });
  });

  describe("Request Logging Middleware", () => {
    test("should attach request log object", () => {
      const req = { id: "test-id-123", method: "GET", path: "/test" };
      const res = {
        json: vi.fn(),
        on: vi.fn((event, callback) => {
          if (event === "finish") {
            // Simulate finishing the response
            setTimeout(callback, 10);
          }
        }),
        locals: {},
      };
      const next = vi.fn();

      requestLoggingMiddleware(req, res, next);

      expect(req.log).toBeDefined();
      expect(req.log.id).toBe("test-id-123");
      expect(req.log.method).toBe("GET");
      expect(req.log.path).toBe("/test");
      expect(req.log.timestamp).toBeDefined();
      expect(next.calls.length).toBeGreaterThan(0);
    });

    test("should track response duration", () => {
      const req = { id: "test-id", method: "GET", path: "/test" };
      const res = {
        json: vi.fn(),
        on: vi.fn((event, callback) => {
          if (event === "finish") {
            // Simulate finishing the response
            setTimeout(callback, 10);
          }
        }),
        locals: {},
      };
      const next = vi.fn();

      requestLoggingMiddleware(req, res, next);

      // Verify that res.on was called with 'finish' event
      expect(res.on.calls.length).toBeGreaterThan(0);
      expect(res.locals).toBeDefined();
    });
  });
});
