import twilio from "twilio";
import MessagingService from "../services/messagingService.js";
import Pregnancy from "../models/Pregnancy.js";
import DangerReport from "../models/DangerReport.js";
import ANCPregnancy from "../models/ANCPregnancy.js";
import MessageQueue from "../models/MessageQueue.js";
import User from "../models/User.js";
import redis from "../config/redis.js";
import logger from "../utils/logger.js";
import {
  containsOptOutKeyword,
  handleOptOut,
  sendOptOutConfirmation,
} from "../utils/optOutHandler.js";

class WebhookController {
  constructor() {
    this.messagingService = MessagingService;
  }

  validateTwilioSignature(req) {
    // Skip validation in development
    if (process.env.NODE_ENV !== "production") {
      return true;
    }

    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const signature = req.headers["x-twilio-signature"];
    const webhookBaseUrl = process.env.WEBHOOK_BASE_URL;

    if (!authToken || !signature || !webhookBaseUrl) {
      logger.error("Missing Twilio validation configuration");
      return false;
    }

    return twilio.validateRequest(authToken, signature, req.body);
  }

  /**
   * Handle incoming SMS
   */
  async handleIncomingSMS(req, res) {
    const messageId = req.body.message_id;

    // Check for duplicate webhook
    const duplicateKey = `webhook:processed:${messageId}`;
    const isDuplicate = await redis.set(
      duplicateKey,
      "true",
      "EX",
      86400,
      "NX",
    );
    if (!isDuplicate) {
      logger.info(`Duplicate webhook received: ${messageId}`);
      return res.status(200).json({ success: true, duplicate: true });
    }

    // Store with 24-hour TTL
    await redis.setex(duplicateKey, 86400, "true");

    // ADDED: Signature validation
    if (!this.validateTwilioSignature(req)) {
      logger.error("Invalid Twilio signature - rejecting webhook");
      return res.status(403).json({ error: "Invalid signature" });
    }

    try {
      const { from, text, message_id } = req.body;
      logger.info(`Processing SMS from ${from}: ${text}`);

      if (containsOptOutKeyword(text)) {
        return await this.handleOptOutRequest(from, res);
      }

      const user = await this.findAndValidateUser(from);
      if (!user)
        return res
          .status(404)
          .json({ error: "User not found", status: "ignored" });

      const pregnancy = await this.findAndValidatePregnancy(user);
      if (!pregnancy)
        return res
          .status(404)
          .json({ error: "Pregnancy not found", status: "ignored" });

      return await this.processSMSContent(
        user,
        pregnancy,
        text,
        message_id,
        res,
      );
    } catch (error) {
      logger.error("Webhook error:", error);
      return res.status(500).json({ error: error.message });
    }
  }

  async handleOptOutRequest(from, res) {
    logger.info(`Opt-out request from ${from}`);

    const optOutKey = `optout:processed:${from}`;
    const processed = await redis.get(optOutKey);
    if (processed) {
      return res.status(200).json({
        success: true,
        status: "opt_out_processed",
        message: "User has been unsubscribed",
      });
    }

    const user = await User.findOne({ phone: from });

    if (user) {
      await handleOptOut(from, "User sent STOP keyword via SMS");
      await sendOptOutConfirmation(from, this.messagingService);
      await redis.setex(optOutKey, 3600, "true");
    } else {
      logger.warn(`Opt-out request from unknown number: ${from}`);
    }

    return res.status(200).json({
      success: true,
      status: "opt_out_processed",
      message: "User has been unsubscribed",
    });
  }

  async findAndValidateUser(phone) {
    const user = await User.findOne({ phone });
    if (!user) {
      logger.debug(`User not found for number: ${phone}`);
      return null;
    }
    return user;
  }

  async findAndValidatePregnancy(user) {
    const pregnancy = await Pregnancy.findOne({ womanId: user._id }).populate(
      "womanId chewId",
    );

    if (!pregnancy) {
      logger.debug(`No pregnancy found for user: ${user._id}`);
      return null;
    }

    logger.debug(`Found pregnancy for ${user.name}: ${pregnancy._id}`);
    return pregnancy;
  }

  async processSMSContent(user, pregnancy, text, message_id, res) {
    // Parse symptoms
    const symptoms = this.parseSymptoms(text);
    logger.debug(`Parsed symptoms: ${JSON.stringify(symptoms)}`);

    // Determine severity
    const severity = this.determineSeverity(symptoms);

    // Generate triage message
    const triageMessage = this.generateTriageMessage(severity);

    const triageResult = {
      severity: severity,
      message: triageMessage,
      symptoms: symptoms,
    };

    // Store danger report
    const report = await this.storeDangerReport(
      pregnancy,
      symptoms,
      triageResult,
      message_id,
    );

    // Log response
    logger.info(`Response to ${user.phone}: ${triageResult.message}`);

    // Handle RED alerts
    if (triageResult.severity === "RED") {
      await this.handleRedAlert(pregnancy, triageResult, report);
    }

    // Update pregnancy last checkin
    pregnancy.lastCheckin = new Date();
    await pregnancy.save();

    return res.status(200).json({
      success: true,
      status: "processed",
      triage: triageResult.severity,
      reportId: report._id,
    });
  }

  determineSeverity(symptoms) {
    const RED_SYMPTOMS = new Set([1, 2, 3, 7, 8]);
    const YELLOW_SYMPTOMS = new Set([4, 5, 6]);

    // Check for no symptoms case
    if (this.hasNoSymptoms(symptoms)) {
      return "GREEN";
    }

    // Check for RED symptoms first (highest priority)
    if (symptoms.some((symptom) => RED_SYMPTOMS.has(symptom))) {
      return "RED";
    }

    // Check for YELLOW symptoms
    if (symptoms.some((symptom) => YELLOW_SYMPTOMS.has(symptom))) {
      return "YELLOW";
    }

    return "GREEN";
  }

  hasNoSymptoms(symptoms) {
    return (
      symptoms.length === 0 || (symptoms.length === 1 && symptoms[0] === 0)
    );
  }

  generateTriageMessage(severity) {
    const messages = {
      RED: "You reported symptoms that need attention. Please visit your health facility or contact your CHEW immediately.",
      YELLOW:
        "You reported symptoms that may need attention. Please monitor your condition and contact your CHEW if symptoms persist.",
      GREEN:
        "Thank you for your response. You reported no symptoms. Continue to monitor your health and attend your ANC visits.",
    };

    return messages[severity];
  }

  parseSymptoms(smsText) {
    // Extract numbers from SMS
    const numbers = smsText.match(/\d+/g);

    if (!numbers) return [];

    // Convert to integers and filter valid symptoms (0-8)
    const symptoms = numbers
      .map((n) => Number.parseInt(n))
      .filter((n) => n >= 0 && n <= 8);

    // Remove duplicates
    return [...new Set(symptoms)];
  }

  async storeDangerReport(pregnancy, symptoms, triageResult, messageId) {
    let chewId = pregnancy.chewId?._id;

    // If pregnancy doesn't have a CHEW, try to find one by LGA or default
    if (!chewId) {
      logger.warn(
        `No CHEW associated with pregnancy, attempting to find one...`,
      );
      // In production, would query by LGA or other logic
      // For now, just log it
    }

    const report = new DangerReport({
      pregnancyId: pregnancy._id,
      womanId: pregnancy.womanId?._id,
      chewId: chewId,
      reportedSymptoms: symptoms,
      triageOutcome: triageResult.severity,
      triageMessage: triageResult.message,
      source: "sms",
      messageId: messageId,
      requiresFollowup: triageResult.severity === "RED",
      timestamp: new Date(),
    });

    await report.save();
    logger.info(`Danger report saved: ${report._id}`);

    // Update ANC pregnancy record if it exists
    const ancPregnancy = await ANCPregnancy.findOne({
      pregnancyId: pregnancy._id,
    });
    if (ancPregnancy) {
      if (!ancPregnancy.redFlagHistory) ancPregnancy.redFlagHistory = [];
      ancPregnancy.redFlagHistory.push({
        timestamp: new Date(),
        symptoms: symptoms,
        triageOutcome: triageResult.severity,
        chewAlerted: false,
        trustedAlerted: false,
      });
      await ancPregnancy.save();
    }

    return report;
  }

  async handleRedAlert(pregnancy, triageResult, report) {
    // Alert CHEW via SMS
    const chewPhone = pregnancy.chewId?.phone;
    if (chewPhone) {
      const alertMessage = `🚨 RED ALERT: ${pregnancy.womanId?.name} (${pregnancy.womanId?.phone}) reported: ${triageResult.symptoms?.map((s) => s.name).join(", ") || triageResult.symptoms?.join(", ")}. Week ${pregnancy.gestationalWeek}. Follow up immediately.`;

      await MessagingService.queueMessage({
        to: chewPhone,
        content: alertMessage,
        language: "en",
        type: "alert",
        priority: "high",
        metadata: {
          pregnancyId: pregnancy._id,
          reportId: report._id,
          type: "chew_alert",
        },
      });
    }

    // Alert trusted contact
    if (pregnancy.womanId?.trustedContact?.phone) {
      const trustedMessage = `🚨 URGENT: ${pregnancy.womanId?.name} needs immediate medical attention. Please help her get to the nearest health facility NOW. For more info, contact CHEW: ${chewPhone || "your local health worker"}`;

      await MessagingService.queueMessage({
        to: pregnancy.womanId.trustedContact.phone,
        content: trustedMessage,
        language: pregnancy.womanId.trustedContact.preferredLanguage || "en",
        type: "alert",
        priority: "high",
        metadata: {
          pregnancyId: pregnancy._id,
          reportId: report._id,
          type: "trusted_alert",
        },
      });
    }

    // Update report with alert status
    report.chewAlerted = !!chewPhone;
    report.trustedAlerted = !!pregnancy.womanId?.trustedContact?.phone;
    await report.save();
  }

  /**
   * Handle delivery report webhook
   */
  async handleDeliveryReport(req, res) {
    try {
      const { message_id, status } = req.body;

      // Update message queue with delivery status
      const updatedMessage = await MessageQueue.findOneAndUpdate(
        { "metadata.externalMessageId": message_id },
        { status: status, deliveredAt: new Date() },
        { new: true },
      );

      res.status(200).json({
        status: "received",
        message_id: message_id,
        updated: !!updatedMessage,
      });
    } catch (error) {
      logger.error("Delivery report error:", error);
      res.status(200).json({ status: "error" }); // Return 200 to acknowledge
    }
  }

  /**
   * Simulate SMS for testing (development only)
   */
  async simulateSMS(req, res) {
    // Defence in depth - never allow in production
    if (process.env.NODE_ENV === "production") {
      return res.status(404).json({ error: "Not found" });
    }

    console.log("=== SIMULATE SMS CALLED ===");
    console.log("Request body:", req.body);

    const { from, text } = req.body;

    if (!from || !text) {
      console.log("Missing parameters!");
      return res.status(400).json({ error: "Missing from or text parameter" });
    }

    console.log(`📱 Simulating SMS from ${from}: ${text}`);

    const mockReq = {
      body: {
        from,
        text,
        message_id: `sim-${Date.now()}`,
      },
    };

    let responseData = null;
    let responseStatus = null;

    const mockRes = {
      status: (code) => {
        responseStatus = code;
        return {
          // Return a resolved Promise so that callers using
          // `return res.status(x).json(...)` are properly awaited.
          // Without this, handleOptOut's DB write races with simulateSMS
          // completing, causing the test to read stale user state.
          json: (data) => {
            responseData = data;
            return Promise.resolve(data);
          },
        };
      },
      json: (data) => {
        responseData = data;
        return Promise.resolve(data);
      },
    };

    await this.handleIncomingSMS(mockReq, mockRes);

    if (responseStatus) {
      res.status(responseStatus).json(responseData);
    } else {
      res.status(200).json(responseData || { success: true });
    }
  }
}

export default new WebhookController();
