import SystemEvent from "../models/SystemEvent.js";
import logger from "../utils/logger.js";

const errorHandler = (err, req, res, next) => {
  logger.error("Error:", {
    requestId: req.id,
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
  });

  // Log to system events for critical errors
  if (err.severity === "CRITICAL" || err.statusCode >= 500) {
    SystemEvent.create({
      type: "SYSTEM_ERROR",
      severity: err.severity || "HIGH",
      message: err.message,
      details: {
        error: err.toString(),
        url: req.url,
        method: req.method,
        ip: req.ip,
        requestId: req.id,
      },
      notificationSent: { slack: false },
    }).catch((error) => {
      logger.error("Failed to create system event:", error);
    });
  }

  // Send response
  const statusCode = err.statusCode || 500;
  const response = {
    error: err.message || "Internal server error",
    status: statusCode,
  };

  // Include requestId for non-500 errors or in development
  if (statusCode < 500 || process.env.NODE_ENV === "development") {
    response.requestId = req.id;
  }

  // Only include stack trace in development
  if (process.env.NODE_ENV === "development") {
    response.stack = err.stack;
    response.details = err.details;
  }

  res.status(statusCode).json(response);
};

class AppError extends Error {
  constructor(message, statusCode, severity = "MEDIUM", details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.severity = severity;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

export { errorHandler, AppError };
