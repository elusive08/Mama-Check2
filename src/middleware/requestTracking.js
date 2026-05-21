import { v4 as uuidv4 } from "uuid";

/**
 * Middleware to add a unique request ID to each request
 * This helps with debugging and tracing requests through logs
 */
export const requestIdMiddleware = (req, res, next) => {
  // Check if request ID already exists (from upstream service)
  const requestId = req.get("X-Request-ID") || uuidv4();

  req.id = requestId;
  res.setHeader("X-Request-ID", requestId);

  next();
};

/**
 * Middleware to log request/response details
 */
export const requestLoggingMiddleware = (req, res, next) => {
  const startTime = Date.now();

  // Log request
  req.log = {
    id: req.id,
    method: req.method,
    path: req.path,
    timestamp: new Date().toISOString(),
  };

  // Override res.json to log response details
  const originalJson = res.json;
  res.json = function (data) {
    const duration = Date.now() - startTime;
    res.locals.duration = duration;
    return originalJson.call(this, data);
  };

  next();
};
