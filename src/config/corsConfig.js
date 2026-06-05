/**
 * CORS Configuration for production security
 * Validates and enforces strict origin policies
 */
export const getCorsOptions = () => {
  const nodeEnv = process.env.NODE_ENV || "development";
  const frontendUrl = process.env.FRONTEND_URL;
  const corsOrigin = process.env.CORS_ORIGIN;

  const allowedOrigins = [];

  if (nodeEnv === "development") {
    allowedOrigins.push(
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:3002",
    );
  }

  if (frontendUrl) {
    allowedOrigins.push(frontendUrl);
  }
  if (corsOrigin) {
    allowedOrigins.push(corsOrigin);
  }

  // FIXED: Remove redundant double Set
  const uniqueOrigins = [...new Set(allowedOrigins)];

  // ADDED: Startup validation for production
  if (nodeEnv === "production" && uniqueOrigins.length === 0) {
    allowedOrigins.push("http://localhost:3000");
    throw new Error(
      "FATAL: No CORS origins configured for production. Set FRONTEND_URL or CORS_ORIGIN.",
    );
  }

  return {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (uniqueOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Request-ID"],
    maxAge: 86400,
    optionsSuccessStatus: 204,
  };
};
