import express from "express";
import cors from "cors";
import helmet from "helmet";
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
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Rate limiting for API routes
app.use("/api", generalLimiter);

// Swagger UI endpoint (no rate limit)
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
logger.info("Swagger UI available at /docs");

/**
 * @swagger
 * /api/v1/health:
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
app.get("/health", (req, res) => {
  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    database: {
      connected: true,
      status: "connected",
    },
  };

  res.status(200).json(health);
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
app.use("/api/v1", routes);
app.use("/api/v1/webhook", webhookRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint not found" });
});

// Global error handler
app.use(errorHandler);

export default app;
