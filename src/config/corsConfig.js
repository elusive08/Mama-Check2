/**
 * CORS Configuration for production security
 * Validates and enforces strict origin policies
 */

/**
 * Parse a comma-separated list of origins from an env var.
 * Trims whitespace and filters empties.
 */
const parseOrigins = (value) =>
  value
    ? value
        .split(",")
        .map((o) => o.trim())
        .filter(Boolean)
    : [];

export const getCorsOptions = () => {
  const nodeEnv = process.env.NODE_ENV || "development";

  const allowedOrigins = new Set();

  if (nodeEnv === "development") {
    [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:3002",
    ].forEach((o) => allowedOrigins.add(o));
  }

  // Support both FRONTEND_URL (single) and CORS_ORIGIN (comma-separated list)
  parseOrigins(process.env.FRONTEND_URL).forEach((o) => allowedOrigins.add(o));
  parseOrigins(process.env.CORS_ORIGIN).forEach((o) => allowedOrigins.add(o));

  if (nodeEnv === "production") {
    if (allowedOrigins.size === 0) {
      console.error(
        "FATAL: No CORS origins configured for production. Set FRONTEND_URL or CORS_ORIGIN.",
      );
      process.exit(1);
    }

    // Strip localhost in production
    for (const origin of allowedOrigins) {
      if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
        allowedOrigins.delete(origin);
      }
    }

    if (allowedOrigins.size === 0) {
      console.error(
        "FATAL: Only localhost origins found in production. Configure proper domain URLs.",
      );
      process.exit(1);
    }
  }

  const originHandler = (origin, callback) => {
    // Allow server-to-server / non-browser requests (no Origin header)
    if (!origin) return callback(null, true);

    if (allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      // Always log rejections regardless of environment for observability
      console.warn(`CORS rejected origin: ${origin}`);
      callback(new Error(`Origin '${origin}' not allowed by CORS`));
    }
  };

  return {
    origin: originHandler,
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-ID",
      "X-Request-Id",
    ],
    exposedHeaders: ["X-Request-ID"],
    maxAge: 86400,
    optionsSuccessStatus: 204,
  };
};
