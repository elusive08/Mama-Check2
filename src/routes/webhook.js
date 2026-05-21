import express from "express";
import webhookController from "../controllers/webhookController.js";
import { webhookLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

/**
 * @swagger
 * /api/v1/webhook/termii/sms:
 *   post:
 *     tags:
 *       - Webhook
 *     summary: Handle incoming SMS
 *     description: Webhook endpoint for receiving incoming SMS from Termii. Handles user responses and STOP keywords.
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
 *               to:
 *                 type: string
 *                 description: Recipient phone number
 *               sms:
 *                 type: string
 *                 description: SMS message content
 *               date:
 *                 type: string
 *                 format: date-time
 *               message_id:
 *                 type: string
 *     responses:
 *       200:
 *         description: SMS processed successfully
 *       400:
 *         description: Invalid webhook payload
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Server error
 */
// Termii incoming SMS webhook
router.post("/termii/sms", webhookLimiter, (req, res) =>
  webhookController.handleIncomingSMS(req, res),
);

/**
 * @swagger
 * /api/v1/webhook/termii/delivery:
 *   post:
 *     tags:
 *       - Webhook
 *     summary: Handle SMS delivery report
 *     description: Webhook endpoint for SMS delivery status updates from Termii
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
 *               phone_number:
 *                 type: string
 *               status:
 *                 type: string
 *                 enum: [delivered, failed, bounced]
 *               error_code:
 *                 type: string
 *     responses:
 *       200:
 *         description: Delivery report processed successfully
 *       400:
 *         description: Invalid webhook payload
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Server error
 */
// Termii delivery report webhook
router.post("/termii/delivery", webhookLimiter, (req, res) =>
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
