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

  // Use 'finish' event to capture all response methods (res.json, res.send, res.end, etc.)
  res.on("finish", () => {
    const duration = Date.now() - startTime;
    res.locals.duration = duration;

    // Log response details
    const logData = {
      requestId: req.id,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: duration,
      timestamp: new Date().toISOString(),
    };

    // Log at appropriate level based on status code
    if (res.statusCode >= 500) {
      console.error("Response error:", logData);
    } else if (res.statusCode >= 400) {
      console.warn("Response warning:", logData);
    } else {
      console.log("Response ok:", logData);
    }
  });

  next();
};
