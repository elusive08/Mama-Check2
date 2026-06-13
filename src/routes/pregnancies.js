import express from "express";
import pregnancyController from "../controllers/pregnancyController.js";
import { authMiddleware, requireCHEW } from "../middleware/auth.js";
import { validateRegistration } from "../middleware/validation.js";
import { registrationLimiter } from "../middleware/rateLimiter.js";
import ANCVisitLog from "../models/ANCVisitLog.js";
import Pregnancy from "../models/Pregnancy.js";

const router = express.Router();

/**
 * @swagger
 * /api/v1/pregnancies/register:
 *   post:
 *     tags:
 *       - Pregnancies
 *     summary: Register a new pregnancy (creates patient + pregnancy)
 *     description: CHEW registers a new pregnant woman into the system. Creates User, Pregnancy, and ANC tracking records.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - phone
 *               - password
 *               - clinicName
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: "Jane"
 *               lastName:
 *                 type: string
 *                 example: "Doe"
 *               phone:
 *                 type: string
 *                 example: "08012345678"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: "SecurePass123"
 *               residentialAddress:
 *                 type: string
 *                 example: "23 Main Street, Ikeja"
 *               lga:
 *                 type: string
 *                 example: "Ikeja"
 *               state:
 *                 type: string
 *                 example: "Lagos"
 *               preferredLanguage:
 *                 type: string
 *                 enum: [en, pidgin, yo, ha, ig]
 *                 default: en
 *               lmp:
 *                 type: string
 *                 format: date
 *                 example: "2025-09-18"
 *               edd:
 *                 type: string
 *                 format: date
 *                 example: "2026-06-25"
 *               clinicName:
 *                 type: string
 *                 example: "Central PHC Ikeja"
 *               trustedContactName:
 *                 type: string
 *                 example: "John Doe"
 *               trustedContactPhone:
 *                 type: string
 *                 example: "08087654321"
 *               trustedContactRelationship:
 *                 type: string
 *                 example: "Husband"
 *               trustedContactLanguage:
 *                 type: string
 *                 enum: [en, pidgin, yo, ha, ig]
 *     responses:
 *       201:
 *         description: Patient and pregnancy registered successfully
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - CHEW role required
 */
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
 *     description: Returns all pregnancies assigned to a specific CHEW
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chewId
 *         required: true
 *         schema:
 *           type: string
 *         description: CHEW user ID
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
 */
router.get("/chew/:chewId", authMiddleware, requireCHEW, (req, res) =>
  pregnancyController.getCHEWPregnancies(req, res),
);

/**
 * @swagger
 * /api/v1/pregnancies/{pregnancyId}:
 *   get:
 *     tags:
 *       - Pregnancies
 *     summary: Get pregnancy by ID
 *     description: Returns detailed information about a specific pregnancy
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
 *       404:
 *         description: Pregnancy not found
 */
router.get("/:pregnancyId", authMiddleware, (req, res) =>
  pregnancyController.getPregnancyById(req, res),
);

/**
 * @swagger
 * /api/v1/pregnancies/{pregnancyId}/attended/undo:
 *   post:
 *     tags:
 *       - Pregnancies
 *     summary: Undo visit attendance
 *     description: Undo a previously marked ANC visit attendance (within 10 minutes)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pregnancyId
 *         required: true
 *         schema:
 *           type: string
 *         description: Pregnancy ID
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 example: "Marked by mistake"
 *     responses:
 *       200:
 *         description: Visit attendance undone successfully
 *       400:
 *         description: Undo window expired (after 10 minutes)
 *       404:
 *         description: No attendance record found
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/:pregnancyId/attended/undo",
  authMiddleware,
  requireCHEW,
  async (req, res) => {
    try {
      const { pregnancyId } = req.params;

      const pregnancy = await Pregnancy.findById(pregnancyId).lean();
      if (!pregnancy) {
        return res
          .status(404)
          .json({ success: false, error: "Pregnancy not found" });
      }

      // Find the most recent marked_attended log for this pregnancy
      const lastLog = await ANCVisitLog.findOne({
        pregnancyId,
        action: "marked_attended",
      }).sort({ markedAtTime: -1 });

      if (!lastLog) {
        return res
          .status(404)
          .json({ success: false, error: "No attendance record found" });
      }

      const timeSince = Date.now() - new Date(lastLog.markedAtTime).getTime();
      if (timeSince > 10 * 60 * 1000) {
        return res.status(400).json({
          success: false,
          error: "Undo window expired. Cannot undo attendance after 10 minutes",
        });
      }

      const undoLog = await ANCVisitLog.create({
        pregnancyId,
        womanId: lastLog.womanId,
        chewId: req.user._id,
        visitWeek: lastLog.visitWeek,
        action: "undone",
        attendedDate: lastLog.attendedDate || new Date(),
        markedAtTime: new Date(),
        notes: req.body.reason || "Undone by CHEW",
      });

      res.status(200).json({ success: true, data: undoLog });
    } catch (error) {
      console.error("Error undoing visit:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
);

/**
 * @swagger
 * /api/v1/pregnancies/{pregnancyId}/attended:
 *   post:
 *     tags:
 *       - Pregnancies
 *     summary: Mark ANC visit as attended
 *     description: Mark a specific ANC milestone visit as attended by the pregnant woman
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: pregnancyId
 *         required: true
 *         schema:
 *           type: string
 *         description: Pregnancy ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               milestoneNumber:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 8
 *                 example: 4
 *               visitWeek:
 *                 type: integer
 *                 example: 4
 *     responses:
 *       200:
 *         description: Visit marked as attended successfully
 *       404:
 *         description: Pregnancy not found
 *       401:
 *         description: Unauthorized
 */
router.post(
  "/:pregnancyId/attended",
  authMiddleware,
  requireCHEW,
  async (req, res) => {
    try {
      const { pregnancyId } = req.params;
      const { milestoneNumber, visitWeek } = req.body;
      const week = visitWeek || milestoneNumber || 1;

      const pregnancy = await Pregnancy.findById(pregnancyId).lean();
      if (!pregnancy) {
        return res
          .status(404)
          .json({ success: false, error: "Pregnancy not found" });
      }

      // womanId is stored directly on the Pregnancy model
      const womanId = pregnancy.womanId;

      const log = await ANCVisitLog.create({
        pregnancyId,
        womanId,
        chewId: req.user._id,
        visitWeek: week,
        action: "marked_attended",
        attendedDate: new Date(),
        markedAtTime: new Date(),
      });

      res.status(200).json({ success: true, data: log });
    } catch (error) {
      console.error("Error marking visit:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
);

/**
 * @swagger
 * /api/v1/pregnancies/{pregnancyId}:
 *   put:
 *     tags:
 *       - Pregnancies
 *     summary: Update pregnancy information
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
 *               clinicName:
 *                 type: string
 *               address:
 *                 type: object
 *               status:
 *                 type: string
 *                 enum: [active, completed, referred, archived]
 *     responses:
 *       200:
 *         description: Pregnancy updated successfully
 *       404:
 *         description: Pregnancy not found
 */
router.put("/:pregnancyId", authMiddleware, requireCHEW, (req, res) =>
  pregnancyController.updatePregnancy(req, res),
);

/**
 * @swagger
 * /api/v1/pregnancies/{pregnancyId}/danger-reports:
 *   get:
 *     tags:
 *       - Pregnancies
 *     summary: Get danger reports for a pregnancy
 *     description: Returns all danger reports/symptoms reported during this pregnancy
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
 *                 properties:
 *                   symptoms:
 *                     type: array
 *                   triageOutcome:
 *                     type: string
 *                   reportedAt:
 *                     type: string
 *                     format: date-time
 */
router.get("/:pregnancyId/danger-reports", authMiddleware, (req, res) =>
  pregnancyController.getDangerReports(req, res),
);

/**
 * @swagger
 * /api/v1/pregnancies/{pregnancyId}/attendance-history:
 *   get:
 *     tags:
 *       - Pregnancies
 *     summary: Get ANC visit attendance history
 *     description: Returns the complete attendance history for this pregnancy
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
 *         description: Attendance history array
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   visitWeek:
 *                     type: integer
 *                   action:
 *                     type: string
 *                   attendedDate:
 *                     type: string
 *                     format: date-time
 *                   markedAtTime:
 *                     type: string
 *                     format: date-time
 *                   canUndo:
 *                     type: boolean
 *       404:
 *         description: Pregnancy not found
 */
router.get(
  "/:pregnancyId/attendance-history",
  authMiddleware,
  async (req, res) => {
    try {
      const { pregnancyId } = req.params;

      const pregnancy = await Pregnancy.findById(pregnancyId).lean();
      if (!pregnancy) {
        return res
          .status(404)
          .json({ success: false, error: "Pregnancy not found" });
      }

      const logs = await ANCVisitLog.find({ pregnancyId })
        .sort({ markedAtTime: -1 })
        .lean({ virtuals: true });

      res.status(200).json(logs);
    } catch (error) {
      console.error("Error getting attendance history:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
);

export default router;
