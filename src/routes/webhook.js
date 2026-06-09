import express from "express";
import webhookController from "../controllers/webhookController.js";
import { webhookLimiter } from "../middleware/rateLimiter.js";

const router = express.Router();

/**
 * @swagger
 * /api/v1/webhook/incoming:
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
 *       401:
 *         description: Invalid signature (production)
 *       429:
 *         description: Too many requests
 */
router.post("/incoming", webhookLimiter, (req, res) =>
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
 *       429:
 *         description: Too many requests
 */
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
 *               - from
 *               - text
 *             properties:
 *               from:
 *                 type: string
 *                 example: "+2348012345678"
 *               text:
 *                 type: string
 *                 example: "STOP"
 *     responses:
 *       200:
 *         description: SMS simulation successful
 *       400:
 *         description: Invalid simulation payload
 *       404:
 *         description: Endpoint not available in production
 */
// Development only - NEVER exposed in production
if (process.env.NODE_ENV !== "production") {
  router.post("/simulate-sms", (req, res) =>
    webhookController.simulateSMS(req, res),
  );
}

export default router;
