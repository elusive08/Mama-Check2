import { createHmac, timingSafeEqual } from "node:crypto";
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

const isProduction = process.env.NODE_ENV === "production";
const DOCS_API_KEY = process.env.DOCS_API_KEY;

// ── 1. Request tracking ───────────────────────────────────────────────────────
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);

// ── 2. HTTP access logging ────────────────────────────────────────────────────
app.use(morgan(isProduction ? "combined" : "dev", { stream: logger.stream }));

// ── 3. Helmet ─────────────────────────────────────────────────────────────────
// 'unsafe-inline' + 'unsafe-eval' are required by Swagger UI.
// All other directives remain strict.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https://validator.swagger.io"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: isProduction
      ? { maxAge: 31536000, includeSubDomains: true, preload: true }
      : false,
  }),
);

// ── 4. CORS ───────────────────────────────────────────────────────────────────
app.use(cors(getCorsOptions()));

// ── 5. Body parsing ───────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ── 6. Swagger docs ───────────────────────────────────────────────────────────
// Protected by DOCS_API_KEY in all environments.
// If the key is set, it is always enforced — in development AND production.
// If the key is not set, docs are only accessible in development (never in production).
//
// Access: GET /docs?key=<DOCS_API_KEY>
// On first visit the key is validated, an httpOnly session cookie is set,
// and the browser is redirected to a clean URL so the key is not visible
// in the address bar on subsequent requests.

app.use("/docs", (req, res, next) => {
  const isProd = isProduction;

  // Key not configured — allow in development, block in production
  if (!DOCS_API_KEY) {
    if (!isProd) return next();
    return res.status(401).json({
      success: false,
      message: "API documentation is not publicly available.",
    });
  }

  // Key is configured — always enforce regardless of environment.
  // On first visit: validate key via query param, set session cookie,
  // redirect to clean URL so the key is not visible in the address bar.
  if (req.query.key !== undefined) {
    if (typeof req.query.key !== "string") {
      return res.status(401).json({
        success: false,
        message: "Invalid API key. Access the docs at /docs?key=<DOCS_API_KEY>",
      });
    }

    const keyBuffer = Buffer.from(DOCS_API_KEY);
    const inputBuffer = Buffer.from(req.query.key);
    const isValid =
      keyBuffer.length === inputBuffer.length &&
      timingSafeEqual(keyBuffer, inputBuffer);

    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid API key. Access the docs at /docs?key=<DOCS_API_KEY>",
      });
    }

    // Valid key — set httpOnly session cookie (8 hours) so subsequent
    // browser asset requests don't need the key on every sub-request
    const sessionToken = createHmac("sha256", DOCS_API_KEY)
      .update("docs-session")
      .digest("hex");

    res.cookie("docs_access", sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: isProd,
      maxAge: 8 * 60 * 60 * 1000,
    });

    // Redirect to clean URL — key no longer visible in address bar
    const cleanUrl =
      req.path === "/" || req.path === "" ? "/docs/" : `/docs${req.path}`;
    return res.redirect(cleanUrl);
  }

  // Subsequent asset requests — validate via session cookie
  const cookieHeader = req.headers.cookie || "";
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)docs_access=([^;]*)/);
  const cookieValue = cookieMatch ? decodeURIComponent(cookieMatch[1]) : null;

  const expectedToken = createHmac("sha256", DOCS_API_KEY)
    .update("docs-session")
    .digest("hex");
  const cookieBuffer = Buffer.from(cookieValue || "");
  const expectedBuffer = Buffer.from(expectedToken);
  const isCookieValid =
    cookieBuffer.length === expectedBuffer.length &&
    timingSafeEqual(cookieBuffer, expectedBuffer);

  if (isCookieValid) return next();

  return res.status(401).json({
    success: false,
    message: "Access the docs at /docs?key=<DOCS_API_KEY>",
  });
});

app.use("/docs", swaggerUi.serve);
app.use(
  "/docs",
  swaggerUi.setup(swaggerSpec, {
    swaggerOptions: {
      persistAuthorization: true,
      displayOperationId: false,
    },
    customCss: ".topbar { display: none }",
  }),
);

logger.info(
  `Swagger UI available at /docs${isProduction ? " (requires DOCS_API_KEY)" : " (open — set DOCS_API_KEY to protect)"}`,
);

// ── 7. Health check ───────────────────────────────────────────────────────────

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
  const redisHealth = redisClient.getHealth();
  const redisConnected = redisHealth.connected;

  // Database is critical; Redis is important but the app can function in degraded mode
  const isHealthy = dbConnected;

  return res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? (redisConnected ? "healthy" : "degraded") : "unhealthy",
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || "development",
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

// ── 8. API routes ─────────────────────────────────────────────────────────────
// Webhooks get their own limiter — register before generalLimiter
app.use("/api/v1/webhook", webhookRoutes);

// Apply general rate limiting to all remaining /api routes
app.use("/api", generalLimiter);

// All other API v1 routes
app.use("/api/v1", routes);
app.use("/api/v1/anc", ancRoutes);

// ── 9. 404 fallthrough ────────────────────────────────────────────────────────
app.use((req, res) => {
  return res.status(404).json({
    error: "Endpoint not found",
    path: req.path,
    method: req.method,
  });
});

// ── 10. Global error handler (must be last) ───────────────────────────────────
app.use(errorHandler);

// ── Server lifecycle ──────────────────────────────────────────────────────────

let server = null;

export const startServer = (port) => {
  server = app.listen(port, () => {
    logger.info(`Server running on port ${port} [${process.env.NODE_ENV}]`);
  });

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
