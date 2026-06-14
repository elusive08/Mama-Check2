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

// ==================== NEW MAMACHECK DASHBOARD ENDPOINTS ====================

/**
 * @swagger
 * /api/v1/dashboard/triage-distribution:
 *   get:
 *     tags:
 *       - Dashboard
 *       - MamaCheck Analytics
 *     summary: Get triage level distribution
 *     description: Returns distribution of patients by triage color (GREEN, YELLOW, RED) for dashboard visualization
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: chewId
 *         schema:
 *           type: string
 *         description: Filter by specific CHEW ID (optional)
 *       - in: query
 *         name: lga
 *         schema:
 *           type: string
 *         description: Filter by Local Government Area (supervisor only)
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: Filter by state (supervisor only)
 *     responses:
 *       200:
 *         description: Triage distribution data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 triageDistribution:
 *                   type: object
 *                   properties:
 *                     GREEN:
 *                       type: object
 *                       properties:
 *                         count:
 *                           type: integer
 *                         percentage:
 *                           type: string
 *                     YELLOW:
 *                       type: object
 *                       properties:
 *                         count:
 *                           type: integer
 *                         percentage:
 *                           type: string
 *                     RED:
 *                       type: object
 *                       properties:
 *                         count:
 *                           type: integer
 *                         percentage:
 *                           type: string
 *                 totalPatients:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 */
router.get("/triage-distribution", authMiddleware, (req, res) =>
  dashboardController.getTriageDistribution(req, res),
);

/**
 * @swagger
 * /api/v1/dashboard/patients-by-location:
 *   get:
 *     tags:
 *       - Dashboard
 *       - MamaCheck Analytics
 *     summary: Get patients grouped by location
 *     description: Returns patient counts grouped by city, LGA, or state for geographic visualization
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: chewId
 *         schema:
 *           type: string
 *         description: Filter by specific CHEW ID (optional)
 *       - in: query
 *         name: lga
 *         schema:
 *           type: string
 *         description: Filter by Local Government Area (supervisor only)
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: Filter by state (supervisor only)
 *     responses:
 *       200:
 *         description: Location distribution data
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 locations:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       count:
 *                         type: integer
 *                 totalLocations:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 */
router.get("/patients-by-location", authMiddleware, (req, res) =>
  dashboardController.getPatientsByLocation(req, res),
);

/**
 * @swagger
 * /api/v1/dashboard/gestational-distribution:
 *   get:
 *     tags:
 *       - Dashboard
 *       - MamaCheck Analytics
 *     summary: Get gestational week distribution
 *     description: Returns histogram of patients by gestational week ranges for pregnancy tracking
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: chewId
 *         schema:
 *           type: string
 *         description: Filter by specific CHEW ID (optional)
 *       - in: query
 *         name: lga
 *         schema:
 *           type: string
 *         description: Filter by Local Government Area (supervisor only)
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: Filter by state (supervisor only)
 *     responses:
 *       200:
 *         description: Gestational week distribution
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 distribution:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       range:
 *                         type: string
 *                         example: "13-20"
 *                       count:
 *                         type: integer
 *                 totalPatients:
 *                   type: integer
 *                 averageWeek:
 *                   type: string
 *                   description: Average gestational week across all patients
 *       401:
 *         description: Unauthorized
 */
router.get("/gestational-distribution", authMiddleware, (req, res) =>
  dashboardController.getGestationalWeekDistribution(req, res),
);

/**
 * @swagger
 * /api/v1/dashboard/missed-visits-by-triage:
 *   get:
 *     tags:
 *       - Dashboard
 *       - MamaCheck Analytics
 *     summary: Get missed visits breakdown by triage level
 *     description: Returns missed visit counts categorized by patient triage status (RED, YELLOW, GREEN)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: chewId
 *         schema:
 *           type: string
 *         description: Filter by specific CHEW ID (optional)
 *       - in: query
 *         name: lga
 *         schema:
 *           type: string
 *         description: Filter by Local Government Area (supervisor only)
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: Filter by state (supervisor only)
 *     responses:
 *       200:
 *         description: Missed visits by triage level
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 missedVisits:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       triage:
 *                         type: string
 *                         enum: [GREEN, YELLOW, RED]
 *                       missedVisits:
 *                         type: integer
 *                       patients:
 *                         type: integer
 *                       avgMissedPerPatient:
 *                         type: string
 *                 totalMissedVisits:
 *                   type: integer
 *       401:
 *         description: Unauthorized
 */
router.get("/missed-visits-by-triage", authMiddleware, (req, res) =>
  dashboardController.getMissedVisitsByTriage(req, res),
);

/**
 * @swagger
 * /api/v1/dashboard/patient-count-ranges:
 *   get:
 *     tags:
 *       - Dashboard
 *       - MamaCheck Analytics
 *       - Supervisor Only
 *     summary: Get patient count distribution ranges
 *     description: Returns histogram showing number of CHEWs/LGAs within different patient count ranges (Supervisor only)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [chew, lga]
 *           default: chew
 *         description: Group by CHEW or LGA
 *       - in: query
 *         name: lga
 *         schema:
 *           type: string
 *         description: Filter by Local Government Area
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: Filter by state
 *     responses:
 *       200:
 *         description: Patient count range distribution
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 groupBy:
 *                   type: string
 *                 ranges:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       label:
 *                         type: string
 *                         example: "26-50"
 *                       min:
 *                         type: integer
 *                       max:
 *                         type: integer
 *                       count:
 *                         type: integer
 *                 totalGroups:
 *                   type: integer
 *                 averagePatients:
 *                   type: string
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Supervisor access required
 */
router.get(
  "/patient-count-ranges",
  authMiddleware,
  requireSupervisor,
  (req, res) => dashboardController.getPatientCountRanges(req, res),
);

/**
 * @swagger
 * /api/v1/dashboard/full-dashboard:
 *   get:
 *     tags:
 *       - Dashboard
 *       - MamaCheck Analytics
 *     summary: Get complete dashboard data
 *     description: Combined endpoint that returns all dashboard metrics in a single call for efficient loading
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: chewId
 *         schema:
 *           type: string
 *         description: Filter by specific CHEW ID (optional)
 *       - in: query
 *         name: lga
 *         schema:
 *           type: string
 *         description: Filter by Local Government Area (supervisor only)
 *       - in: query
 *         name: state
 *         schema:
 *           type: string
 *         description: Filter by state (supervisor only)
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [chew, supervisor]
 *           default: chew
 *         description: User role to determine data aggregation level
 *     responses:
 *       200:
 *         description: Complete dashboard dataset
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 dashboard:
 *                   type: object
 *                   properties:
 *                     kpis:
 *                       type: object
 *                       properties:
 *                         totalWomen:
 *                           type: integer
 *                         activePregnancies:
 *                           type: integer
 *                         highRiskWomen:
 *                           type: integer
 *                     triageDistribution:
 *                       type: object
 *                     patientsByLocation:
 *                       type: array
 *                     gestationalWeekDistribution:
 *                       type: array
 *                     missedVisitsByTriage:
 *                       type: array
 *                     patientCountDistribution:
 *                       type: array
 *                     lastUpdated:
 *                       type: string
 *                       format: date-time
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Too many requests - rate limit exceeded
 */
router.get("/full-dashboard", authMiddleware, dashboardLimiter, (req, res) =>
  dashboardController.getFullDashboard(req, res),
);

export default router;
