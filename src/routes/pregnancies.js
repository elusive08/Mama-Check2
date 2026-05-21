import express from "express";
import pregnancyController from "../controllers/pregnancyController.js";
import { authMiddleware, requireCHEW } from "../middleware/auth.js";
import {
  validateRegistration,
  validateVisitAttendance,
} from "../middleware/validation.js";
import { registrationLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

/**
 * @swagger
 * /api/v1/pregnancies/register:
 *   post:
 *     tags:
 *       - Pregnancies
 *     summary: Register new pregnancy
 *     description: Register a new pregnant woman (CHEW only). Initializes ANC tracking and sends confirmation SMS.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *               - firstName
 *               - lastName
 *               - lga
 *               - lmp_date
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+2348012345678"
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               lga:
 *                 type: string
 *               lmp_date:
 *                 type: string
 *                 format: date
 *                 description: Last Menstrual Period date
 *     responses:
 *       201:
 *         description: Pregnancy registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Pregnancy'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       429:
 *         description: Rate limit exceeded
 */
// Register new pregnancy (CHEW only)
router.post(
  "/register",
  authMiddleware,
  requireCHEW,
  registrationLimiter,
  validateRegistration,
  (req, res) => pregnancyController.register(req, res),
);

/**
 * @swagger
 * /api/v1/pregnancies/chew/{chewId}:
 *   get:
 *     tags:
 *       - Pregnancies
 *     summary: Get all pregnancies for a CHEW
 *     description: Retrieve all pregnancies managed by a specific Community Health Extension Worker
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chewId
 *         required: true
 *         schema:
 *           type: string
 *         description: CHEW ID
 *     responses:
 *       200:
 *         description: List of pregnancies
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Pregnancy'
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only CHEW role can access
 */
// Get all pregnancies for CHEW
router.get("/chew/:chewId", authMiddleware, requireCHEW, (req, res) =>
  pregnancyController.getCHEWPregnancies(req, res),
);

/**
 * @swagger
 * /api/v1/pregnancies/{pregnancyId}:
 *   get:
 *     tags:
 *       - Pregnancies
 *     summary: Get pregnancy details
 *     description: Retrieve detailed information for a specific pregnancy
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pregnancyId
 *         required: true
 *         schema:
 *           type: string
 *         description: Pregnancy ID
 *     responses:
 *       200:
 *         description: Pregnancy details
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Pregnancy'
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Pregnancy not found
 */
// Get single pregnancy details
router.get("/:pregnancyId", authMiddleware, (req, res) =>
  pregnancyController.getPregnancyById(req, res),
);

/**
 * @swagger
 * /api/v1/pregnancies/{pregnancyId}/attended:
 *   post:
 *     tags:
 *       - Pregnancies
 *     summary: Mark ANC visit as attended
 *     description: Record that a scheduled ANC visit was attended. Triggers triage workflow.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pregnancyId
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
 *               - vitals
 *             properties:
 *               vitals:
 *                 type: object
 *                 properties:
 *                   bloodPressure:
 *                     type: string
 *                   weight:
 *                     type: number
 *                   temperature:
 *                     type: number
 *     responses:
 *       200:
 *         description: Visit marked as attended
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only CHEW can mark attendance
 *       404:
 *         description: Pregnancy not found
 */
// Mark ANC visit as attended
router.post(
  "/:pregnancyId/attended",
  authMiddleware,
  requireCHEW,
  validateVisitAttendance,
  (req, res) => pregnancyController.markVisitAttended(req, res),
);

/**
 * @swagger
 * /api/v1/pregnancies/{pregnancyId}:
 *   put:
 *     tags:
 *       - Pregnancies
 *     summary: Update pregnancy information
 *     description: Update pregnancy details and tracking information
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pregnancyId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               gestationalAge:
 *                 type: number
 *               riskLevel:
 *                 type: string
 *                 enum: [low, medium, high]
 *               notes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Pregnancy updated successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only CHEW can update
 *       404:
 *         description: Pregnancy not found
 */
// Update pregnancy information
router.put("/:pregnancyId", authMiddleware, requireCHEW, (req, res) =>
  pregnancyController.updatePregnancy(req, res),
);

/**
 * @swagger
 * /api/v1/pregnancies/{pregnancyId}/danger-reports:
 *   get:
 *     tags:
 *       - Pregnancies
 *     summary: Get danger reports for pregnancy
 *     description: Retrieve red flag danger reports detected for this pregnancy
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pregnancyId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of danger reports
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Pregnancy not found
 */
// Get danger reports for pregnancy
router.get("/:pregnancyId/danger-reports", authMiddleware, (req, res) =>
  pregnancyController.getDangerReports(req, res),
);

/**
 * @swagger
 * /api/v1/pregnancies/{pregnancyId}/attended/undo:
 *   post:
 *     tags:
 *       - Pregnancies
 *     summary: Undo visit attendance
 *     description: Undo a visit attendance mark (only within 10 minutes of marking)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pregnancyId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 description: Reason for undoing attendance
 *     responses:
 *       200:
 *         description: Attendance undone successfully
 *       400:
 *         description: Cannot undo - 10 minute window expired
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - only CHEW can undo
 *       404:
 *         description: Pregnancy not found
 */
// Undo visit attendance (within 10 minutes)
router.post(
  "/:pregnancyId/attended/undo",
  authMiddleware,
  requireCHEW,
  (req, res) => pregnancyController.undoVisitAttended(req, res),
);

/**
 * @swagger
 * /api/v1/pregnancies/{pregnancyId}/attendance-history:
 *   get:
 *     tags:
 *       - Pregnancies
 *     summary: Get attendance history
 *     description: Retrieve visit attendance history with undo availability status for recent entries
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pregnancyId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Attendance history
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   date:
 *                     type: string
 *                     format: date-time
 *                   status:
 *                     type: string
 *                   canUndo:
 *                     type: boolean
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Pregnancy not found
 */
// Get attendance history with undo availability
router.get("/:pregnancyId/attendance-history", authMiddleware, (req, res) =>
  pregnancyController.getAttendanceHistory(req, res),
);

export default router;
