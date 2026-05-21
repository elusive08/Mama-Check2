/**
 * CORS Configuration for production security
 * Validates and enforces strict origin policies
 */

export const getCorsOptions = () => {
  const nodeEnv = process.env.NODE_ENV || "development";
  const frontendUrl = process.env.FRONTEND_URL;
  const corsOrigin = process.env.CORS_ORIGIN;

  // Allowed origins
  const allowedOrigins = [];

  if (nodeEnv === "development") {
    // Development: allow localhost
    allowedOrigins.push(
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:3002",
    );
  }

  // Always add environment-configured origins
  if (frontendUrl) {
    allowedOrigins.push(frontendUrl);
  }
  if (corsOrigin) {
    allowedOrigins.push(corsOrigin);
  }

  // Remove duplicates
  const uniqueOrigins = new Set(new Set(allowedOrigins));

  return {
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl requests)
      if (!origin) return callback(null, true);

      if (uniqueOrigins.has(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    maxAge: 86400, // 24 hours
    optionsSuccessStatus: 200,
  };
};
