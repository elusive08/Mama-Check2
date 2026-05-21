import dashboardController from "../controllers/dashboardController.js";
import express from "express";
import {
  authMiddleware,
  requireCHEW,
  requireSupervisor,
} from "../middleware/auth.js";
import { dashboardLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

/**
 * @swagger
 * /api/v1/dashboard/chew/overview:
 *   get:
 *     tags:
 *       - Dashboard
 *     summary: Get CHEW dashboard overview
 *     description: Get overview statistics for CHEW including pregnancies, visits, and alerts
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard overview with KPIs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalPregnancies:
 *                   type: number
 *                 activePregnancies:
 *                   type: number
 *                 completedVisits:
 *                   type: number
 *                 pendingVisits:
 *                   type: number
 *                 redFlagAlerts:
 *                   type: number
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only CHEW role can access
 */
router.get(
  "/chew/overview",
  authMiddleware,
  requireCHEW,
  dashboardLimiter,
  (req, res) => dashboardController.getCHEWOverview(req, res),
);

/**
 * @swagger
 * /api/v1/dashboard/chew/women:
 *   get:
 *     tags:
 *       - Dashboard
 *     summary: Get women list for CHEW
 *     description: Get paginated list of pregnant women managed by this CHEW
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, completed, at-risk]
 *     responses:
 *       200:
 *         description: List of pregnant women
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only CHEW role can access
 */
// Get women list for CHEW
router.get(
  "/chew/women",
  authMiddleware,
  requireCHEW,
  dashboardLimiter,
  (req, res) => dashboardController.getCHEWWomen(req, res),
);

/**
 * @swagger
 * /api/v1/dashboard/chew/red-flags:
 *   get:
 *     tags:
 *       - Dashboard
 *     summary: Get red flag alerts
 *     description: Get all danger/red flag alerts for pregnancies under this CHEW
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of red flag alerts
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                   pregnancyId:
 *                     type: string
 *                   severity:
 *                     type: string
 *                     enum: [low, medium, high, critical]
 *                   message:
 *                     type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only CHEW role can access
 */
// Get red flag alerts
router.get(
  "/chew/red-flags",
  authMiddleware,
  requireCHEW,
  dashboardLimiter,
  (req, res) => dashboardController.getRedFlags(req, res),
);

/**
 * @swagger
 * /api/v1/dashboard/red-flags/{reportId}/followup:
 *   put:
 *     tags:
 *       - Dashboard
 *     summary: Update red flag follow-up
 *     description: Record follow-up actions taken on a red flag alert
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: reportId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [resolved, escalated, monitoring]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Follow-up updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only CHEW can update
 *       404:
 *         description: Report not found
 */
// Update red flag follow-up
router.put(
  "/red-flags/:reportId/followup",
  authMiddleware,
  requireCHEW,
  (req, res) => dashboardController.updateFollowup(req, res),
);

/**
 * @swagger
 * /api/v1/dashboard/chew/weekly-summary:
 *   get:
 *     tags:
 *       - Dashboard
 *     summary: Get weekly summary
 *     description: Get weekly performance summary for CHEW activities
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Weekly summary with metrics
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only CHEW role can access
 */
// Get weekly summary
router.get("/chew/weekly-summary", authMiddleware, requireCHEW, (req, res) =>
  dashboardController.getWeeklySummary(req, res),
);

/**
 * @swagger
 * /api/v1/dashboard/supervisor/lga-summary:
 *   get:
 *     tags:
 *       - Dashboard
 *     summary: Get LGA summary
 *     description: Get health metrics summary for all CHEWs in an LGA (Supervisor only)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: LGA summary with aggregated metrics
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only Supervisor role can access
 */
// Supervisor views
router.get(
  "/supervisor/lga-summary",
  authMiddleware,
  requireSupervisor,
  (req, res) => dashboardController.getLGASummary(req, res),
);

/**
 * @swagger
 * /api/v1/dashboard/supervisor/chew-performance:
 *   get:
 *     tags:
 *       - Dashboard
 *     summary: Get CHEW performance metrics
 *     description: Get performance metrics for all CHEWs in supervisor's jurisdiction
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: CHEW performance metrics
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only Supervisor role can access
 */
router.get(
  "/supervisor/chew-performance",
  authMiddleware,
  requireSupervisor,
  (req, res) => dashboardController.getCHEWPerformance(req, res),
);

export default router;
