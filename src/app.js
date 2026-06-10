import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose from "mongoose";
import ancRoutes from "./routes/anc.js";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import routes from "./routes/index.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { generalLimiter } from "./middleware/rateLimiter.js";
import {
  requestIdMiddleware,
  requestLoggingMiddleware,
} from "./middleware/requestTracking.js";
import logger from "./utils/logger.js";
import { getCorsOptions } from "./config/corsConfig.js";
import swaggerSpec from "../swagger.js";
import webhookRoutes from "./routes/webhook.js";

const app = express();

// Security middleware
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

// CORS configuration
app.use(cors(getCorsOptions()));

// Logging
app.use(morgan("combined", { stream: logger.stream }));

// Request tracking middleware
app.use(requestIdMiddleware);
app.use(requestLoggingMiddleware);

// Body parsing
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

const isProduction = process.env.NODE_ENV === "production";
const docsApiKey = process.env.DOCS_API_KEY;

// Helper to validate API key
const validateDocsKey = (req) => {
  if (!isProduction) return true;
  if (!docsApiKey) return false;

  // Check Authorization header or query param
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader === `Bearer ${docsApiKey}`) {
    return true;
  }

  const queryKey = req.query.key;
  if (queryKey && queryKey === docsApiKey) {
    return true;
  }

  return false;
};

// Swagger UI
app.use("/docs", (req, res, next) => {
  if (validateDocsKey(req)) {
    next();
  } else {
    res.status(401).json({
      error: "Unauthorized",
      message: "Access to API documentation requires a valid API key",
    });
  }
});

if (docsApiKey || !isProduction) {
  app.use(
    "/docs",
    swaggerUi.serve,
    swaggerUi.setup(swaggerSpec, {
      swaggerOptions: {
        persistAuthorization: true,
        displayOperationId: false,
      },
      customCss: `.topbar { display: none }`,
    }),
  );
  logger.info(
    `Swagger UI available at /docs${isProduction ? " (protected)" : ""}`,
  );
}

/**
 * @swagger
 * /health:
 *   get:
 *     tags:
 *       - Health
 *     summary: API health check
 *     description: Returns the health status of the API and connected services
 *     security: []
 *     responses:
 *       200:
 *         description: API is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: ["healthy", "degraded"]
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 uptime:
 *                   type: number
 *                   description: Server uptime in seconds
 *                 environment:
 *                   type: string
 *                   example: "development"
 *                 database:
 *                   type: object
 *                   properties:
 *                     connected:
 *                       type: boolean
 *                     status:
 *                       type: string
 *       503:
 *         description: API is degraded or unavailable
 */
// Health check endpoint (no rate limit)
app.get("/health", async (req, res) => {
  let redisStatus = "unknown";
  let redisConnected = false;

  try {
    // Dynamically import to avoid issues if not available
    const redisModule = await import("./config/redis.js");
    const redisClient = redisModule.default;

    if (redisClient && typeof redisClient.ping === "function") {
      await redisClient.ping();
      redisStatus = "connected";
      redisConnected = true;
    } else {
      redisStatus = "not_configured";
      redisConnected = true; // Consider it OK if Redis is optional
    }
  } catch (error) {
    // Log the error instead of empty catch
    logger.warn(`Redis health check failed: ${error.message}`);
    redisStatus = "disconnected";
    redisConnected = process.env.REDIS_REQUIRED !== "true";
  }

  const dbConnected = mongoose.connection.readyState === 1;
  const isHealthy = dbConnected && redisConnected;

  const health = {
    status: isHealthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    // Backward compatible: include database at root level for tests
    database: {
      connected: dbConnected,
      status: dbConnected ? "connected" : "disconnected",
    },
    // Also include the detailed services structure
    services: {
      database: {
        connected: dbConnected,
        status: dbConnected ? "connected" : "disconnected",
      },
      redis: {
        connected: redisStatus === "connected",
        status: redisStatus,
      },
    },
  };

  const statusCode = health.status === "healthy" ? 200 : 503;
  res.status(statusCode).json(health);
});
// API info endpoint
app.get("/api", (req, res) => {
  res.status(200).json({
    name: "MamaCheck API",
    version: "1.0.0",
    description: "Maternal and child health platform",
    endpoints: {
      auth: "/api/v1/auth",
      pregnancies: "/api/v1/pregnancies",
      dashboard: "/api/v1/dashboard",
      chew: "/api/v1/chew",
      webhook: "/api/v1/webhook",
    },
  });
});

// API routes
app.use("/api/v1/webhook", webhookRoutes);

// Rate limiting for API routes
app.use("/api", generalLimiter);

app.use("/api/v1", routes);
app.use("/api/v1/anc", ancRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Global error handler
app.use(errorHandler);

let server = null;

export const startServer = (port) => {
  server = app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
  });
  return server;
};

export const closeServer = async () => {
  if (server) {
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
};

export default app;
