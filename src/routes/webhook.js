import express from "express";
import webhookController from "../controllers/webhookController.js";
import { webhookLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

/**
 * @swagger
 * /api/v1/webhook/sms:
 *   post:
 *     tags:
 *       - Webhook
 *     summary: Handle incoming SMS
 *     description: Generic webhook endpoint for receiving incoming SMS. Handles user responses and STOP keywords.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               from:
 *                 type: string
 *                 description: Sender phone number
 *               text:
 *                 type: string
 *                 description: SMS message content
 *               message_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: SMS processed successfully
 */
// Incoming SMS webhook
router.post("/sms", webhookLimiter, (req, res) =>
  webhookController.handleIncomingSMS(req, res),
);

/**
 * @swagger
 * /api/v1/webhook/delivery:
 *   post:
 *     tags:
 *       - Webhook
 *     summary: Handle SMS delivery report
 *     description: Generic webhook endpoint for SMS delivery status updates
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               message_id:
 *                 type: string
 *               status:
 *                 type: string
 *     responses:
 *       200:
 *         description: Delivery report processed successfully
 */
// Delivery report webhook
router.post("/delivery", webhookLimiter, (req, res) =>
  webhookController.handleDeliveryReport(req, res),
);

/**
 * @swagger
 * /api/v1/webhook/simulate-sms:
 *   post:
 *     tags:
 *       - Webhook
 *     summary: Simulate incoming SMS (development only)
 *     description: Test endpoint for simulating incoming SMS messages. Available only in development environment.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *               - message
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+2348012345678"
 *               message:
 *                 type: string
 *                 example: "1 means YES, 2 means NO"
 *     responses:
 *       200:
 *         description: SMS simulation successful
 *       400:
 *         description: Invalid simulation payload
 *       500:
 *         description: Server error
 */
// Mock webhook for testing (development and test environments)
if (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test") {
  router.post("/simulate-sms", (req, res) =>
    webhookController.simulateSMS(req, res),
  );
}

// Also add a test endpoint for SMS simulation with the correct path
if (process.env.NODE_ENV === "test") {
  router.post("/test-sms", (req, res) =>
    webhookController.simulateSMS(req, res),
  );
}

export default router;
