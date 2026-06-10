import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";

import routes from "./routes/index.js";
import ancRoutes from "./routes/anc.js";
import webhookRoutes from "./routes/webhook.js";

import { errorHandler } from "./middleware/errorHandler.js";
import { generalLimiter } from "./middleware/rateLimiter.js";
import {
  requestIdMiddleware,
  requestLoggingMiddleware,
} from "./middleware/requestTracking.js";

import logger from "./utils/logger.js";
import { getCorsOptions } from "./config/corsConfig.js";
import redisClient from "./config/redis.js";
import swaggerSpec from "../swagger.js";

const app = express();

// ── Security ──────────────────────────────────────────────────────────────────

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: true,
  }),
);

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors(getCorsOptions()));

// ── Request tracking (before body parsing so IDs are available everywhere) ────
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);

// ── HTTP access logging ───────────────────────────────────────────────────────
app.use(morgan("combined", { stream: logger.stream }));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── Swagger / API docs ────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === "production";
const docsApiKey = process.env.DOCS_API_KEY;

const validateDocsKey = (req) => {
  if (!isProduction) return true;
  if (!docsApiKey) return false;

  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${docsApiKey}`) return true;

  return req.query.key === docsApiKey;
};

// Gate the entire /docs subtree — applies to both .serve and .setup
app.use("/docs", (req, res, next) => {
  if (validateDocsKey(req)) return next();
  return res.status(401).json({
    error: "Unauthorized",
    message: "Access to API documentation requires a valid API key",
  });
});

if (docsApiKey || !isProduction) {
  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      swaggerOptions: { persistAuthorization: true, displayOperationId: false },
      customCss: ".topbar { display: none }",
    }),
  );
  logger.info(
    `Swagger UI available at /docs${isProduction ? " (API key protected)" : ""}`,
  );
}

// ── Utility endpoints (no rate limit, no auth) ────────────────────────────────

/**
 * @swagger
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: API health check
 *     security: []
 *     responses:
 *       200: { description: API is healthy }
 *       503: { description: API is degraded }
 */
app.get("/health", async (req, res) => {
  const dbConnected = mongoose.connection.readyState === 1;

  // Use the already-imported singleton — no dynamic import needed
  const redisHealth = redisClient.getHealth();
  const redisConnected = redisHealth.connected;

  const isHealthy = dbConnected && redisConnected;

  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || "development",
    // Kept at root level for backward compatibility with existing tests
    database: {
      connected: dbConnected,
      status: dbConnected ? "connected" : "disconnected",
    },
    services: {
      database: {
        connected: dbConnected,
        status: dbConnected ? "connected" : "disconnected",
      },
      redis: {
        connected: redisConnected,
        status: redisHealth.status,
      },
    },
  });
});

app.get("/api", (req, res) => {
  return res.status(200).json({
    name: "MamaCheck API",
    version: "1.0.0",
    description: "Maternal and child health platform",
    endpoints: {
      auth: "/api/v1/auth",
      pregnancies: "/api/v1/pregnancies",
      dashboard: "/api/v1/dashboard",
      chew: "/api/v1/chew",
      webhook: "/api/v1/webhook",
      anc: "/api/v1/anc",
    },
  });
});

// ── API routes ────────────────────────────────────────────────────────────────
// IMPORTANT: generalLimiter must be registered BEFORE the route handlers,
// not after. The original code registered it after webhookRoutes, meaning
// webhook calls were never rate-limited by generalLimiter.

// Webhooks get their own limiter (defined in rateLimiter.js / webhook.js)
// so they are exempt from generalLimiter — register them before it.
app.use("/api/v1/webhook", webhookRoutes);

// Apply general rate limiting to all remaining /api routes
app.use("/api", generalLimiter);

// All other API v1 routes
app.use("/api/v1", routes);
app.use("/api/v1/anc", ancRoutes);

// ── 404 fallthrough ───────────────────────────────────────────────────────────
app.use((req, res) => {
  return res.status(404).json({
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
  });
});

// ── Global error handler (must be last) ──────────────────────────────────────
app.use(errorHandler);

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server = null;

export const startServer = (port) => {
  server = app.listen(port, () => {
    logger.info(`Server running on port ${port} [${process.env.NODE_ENV}]`);
  });

  // Propagate unhandled connection-level errors (e.g. EADDRINUSE)
  server.on("error", (err) => {
    logger.error("Server error:", err);
    process.exit(1);
  });

  return server;
};

export const closeServer = () =>
  new Promise((resolve, reject) => {
    if (!server) return resolve();
    server.close((err) => (err ? reject(err) : resolve()));
  });

export default app;
