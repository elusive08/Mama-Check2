import dashboardController from "../controllers/dashboardController.js";
import express from "express";
import { authMiddleware, requireCHEW } from "../middleware/auth.js";
import { dashboardLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

/**
 * @swagger
 * /api/v1/chew/dashboard:
 *   get:
 *     tags:
 *       - CHEW
 *     summary: Get CHEW dashboard overview
 *     description: Get dashboard overview with assigned pregnancies and daily tasks
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard overview
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only CHEW role can access
 */
// Get CHEW dashboard overview
router.get(
  "/dashboard",
  authMiddleware,
  requireCHEW,
  dashboardLimiter,
  (req, res) => dashboardController.getCHEWOverview(req, res),
);

/**
 * @swagger
 * /api/v1/chew/women:
 *   get:
 *     tags:
 *       - CHEW
 *     summary: Get assigned women list
 *     description: Get list of pregnant women assigned to this CHEW
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of assigned women
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only CHEW role can access
 */
// Get women list for CHEW
router.get(
  "/women",
  authMiddleware,
  requireCHEW,
  dashboardLimiter,
  (req, res) => dashboardController.getCHEWWomen(req, res),
);

/**
 * @swagger
 * /api/v1/chew/red-flags:
 *   get:
 *     tags:
 *       - CHEW
 *     summary: Get red flag alerts
 *     description: Get all danger alerts for assigned pregnancies
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of red flag alerts
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only CHEW role can access
 */
// Get red flag alerts
router.get(
  "/red-flags",
  authMiddleware,
  requireCHEW,
  dashboardLimiter,
  (req, res) => dashboardController.getRedFlags(req, res),
);

export default router;
