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

  /**
   * Validate incoming webhook signature.
   * For BulkSMS Nigeria, validate their HMAC header when they add one.
   * For now: skip in non-production; enforce in production via the
   * WEBHOOK_SECRET env var (set it to a shared secret with BulkSMS).
   */
  validateWebhookSignature(req) {
    if (process.env.NODE_ENV !== "production") return true;

    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) {
      logger.error("WEBHOOK_SECRET not set — rejecting incoming webhook");
      return false;
    }

    // BulkSMS Nigeria sends delivery reports; add their specific header
    // validation here once documented. For now accept if secret is set.
    return true;
  }

  /**
   * Handle incoming SMS from BulkSMS delivery webhook.
   * Expected body: { from, text, message_id, ... }
   */
  async handleIncomingSMS(req, res) {
    const messageId = req.body?.message_id;

    // ── Idempotency guard: reject duplicate deliveries ──────────────────────
    // Use setnx (SET ... NX EX) so we get atomicity:
    // returns the set value on first call, null on subsequent ones.
    if (messageId) {
      const duplicateKey = `webhook:processed:${messageId}`;
      const claimed = await redis.setnx(duplicateKey, "1", 86400);
      if (!claimed) {
        logger.info(`Duplicate webhook ignored: ${messageId}`);
        return res.status(200).json({ success: true, duplicate: true });
      }
    }

    if (!this.validateWebhookSignature(req)) {
      logger.error("Invalid webhook signature — rejecting");
      return res.status(403).json({ error: "Invalid signature" });
    }

    try {
      const { from, text, message_id } = req.body;

      if (!from || !text) {
        return res.status(400).json({ error: "Missing 'from' or 'text'" });
      }

      logger.info(`Incoming SMS from ${from}: ${text}`);

      if (containsOptOutKeyword(text)) {
        return await this.handleOptOutRequest(from, res);
      }

      const user = await this.findAndValidateUser(from);
      if (!user) {
        return res
          .status(404)
          .json({ error: "User not found", status: "ignored" });
      }

      const pregnancy = await this.findAndValidatePregnancy(user);
      if (!pregnancy) {
        return res
          .status(404)
          .json({ error: "Pregnancy not found", status: "ignored" });
      }

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

    // Dedup: if already processed within this hour, return success immediately
    const optOutKey = `optout:processed:${from}`;
    const alreadyProcessed = await redis.get(optOutKey);
    if (alreadyProcessed) {
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
      // Mark processed for 1 hour to deduplicate rapid retries
      await redis.setex(optOutKey, 3600, "1");
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
      logger.debug(`No active pregnancy for user: ${user._id}`);
      return null;
    }
    return pregnancy;
  }

  async processSMSContent(user, pregnancy, text, message_id, res) {
    const symptoms = this.parseSymptoms(text);
    const severity = this.determineSeverity(symptoms);
    const triageMessage = this.generateTriageMessage(severity);

    const triageResult = { severity, message: triageMessage, symptoms };

    const report = await this.storeDangerReport(
      pregnancy,
      symptoms,
      triageResult,
      message_id,
    );

    logger.info(`Triage result for ${user.phone}: ${severity}`);

    if (severity === "RED") {
      await this.handleRedAlert(pregnancy, triageResult, report);
    }

    pregnancy.lastCheckin = new Date();
    await pregnancy.save();

    return res.status(200).json({
      success: true,
      status: "processed",
      triage: severity,
      reportId: report._id,
    });
  }

  determineSeverity(symptoms) {
    const RED_SYMPTOMS = new Set([1, 2, 3, 7, 8]);
    const YELLOW_SYMPTOMS = new Set([4, 5, 6]);

    if (this.hasNoSymptoms(symptoms)) return "GREEN";
    if (symptoms.some((s) => RED_SYMPTOMS.has(s))) return "RED";
    if (symptoms.some((s) => YELLOW_SYMPTOMS.has(s))) return "YELLOW";
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
    const numbers = smsText.match(/\d+/g);
    if (!numbers) return [];
    const symptoms = numbers
      .map((n) => Number.parseInt(n))
      .filter((n) => n >= 0 && n <= 8);
    return [...new Set(symptoms)];
  }

  async storeDangerReport(pregnancy, symptoms, triageResult, messageId) {
    const chewId = pregnancy.chewId?._id;

    const report = new DangerReport({
      pregnancyId: pregnancy._id,
      womanId: pregnancy.womanId?._id,
      chewId,
      reportedSymptoms: symptoms,
      triageOutcome: triageResult.severity,
      triageMessage: triageResult.message,
      source: "sms",
      messageId,
      requiresFollowup: triageResult.severity === "RED",
      timestamp: new Date(),
    });

    await report.save();
    logger.info(`Danger report saved: ${report._id}`);

    const ancPregnancy = await ANCPregnancy.findOne({
      pregnancyId: pregnancy._id,
    });
    if (ancPregnancy) {
      if (!ancPregnancy.redFlagHistory) ancPregnancy.redFlagHistory = [];
      ancPregnancy.redFlagHistory.push({
        timestamp: new Date(),
        symptoms,
        triageOutcome: triageResult.severity,
        chewAlerted: false,
        trustedAlerted: false,
      });
      await ancPregnancy.save();
    }

    return report;
  }

  async handleRedAlert(pregnancy, triageResult, report) {
    const chewPhone = pregnancy.chewId?.phone;

    if (chewPhone) {
      const symptomList =
        triageResult.symptoms?.join(", ") || "reported symptoms";
      await MessagingService.queueMessage({
        to: chewPhone,
        content: `🚨 RED ALERT: ${pregnancy.womanId?.name} (${pregnancy.womanId?.phone}) reported symptoms: ${symptomList}. Week ${pregnancy.gestationalWeek}. Follow up immediately.`,
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

    if (pregnancy.womanId?.trustedContact?.phone) {
      await MessagingService.queueMessage({
        to: pregnancy.womanId.trustedContact.phone,
        content: `🚨 URGENT: ${pregnancy.womanId?.name} needs immediate medical attention. Please help her reach the nearest health facility. Contact CHEW: ${chewPhone || "your local health worker"}`,
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

    report.chewAlerted = !!chewPhone;
    report.trustedAlerted = !!pregnancy.womanId?.trustedContact?.phone;
    await report.save();
  }

  /**
   * Handle delivery report callback from BulkSMS.
   */
  async handleDeliveryReport(req, res) {
    try {
      const { message_id, status } = req.body;

      const updatedMessage = await MessageQueue.findOneAndUpdate(
        { "metadata.externalMessageId": message_id },
        { status, deliveredAt: new Date() },
        { new: true },
      );

      return res.status(200).json({
        status: "received",
        message_id,
        updated: !!updatedMessage,
      });
    } catch (error) {
      logger.error("Delivery report error:", error);
      return res.status(200).json({ status: "error" }); // Always 200 to acknowledge
    }
  }

  /**
   * Simulate an incoming SMS.
   *
   * THIS METHOD IS FOR DEVELOPMENT / TESTING ONLY.
   * It must NEVER be registered on a route in production.
   * Route registration is gated in routes/webhook.js:
   *   if (process.env.NODE_ENV !== "production") { router.post("/simulate-sms", ...) }
   */
  async simulateSMS(req, res) {
    const { from, text } = req.body;

    if (!from || !text) {
      return res.status(400).json({ error: "Missing 'from' or 'text'" });
    }

    logger.info(`[SIMULATE] SMS from ${from}: ${text}`);

    let responseStatus = 200;
    let responseData = null;

    // Minimal mock res that captures status + json without touching HTTP
    const mockRes = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      },
    };

    const mockReq = {
      body: { from, text, message_id: `sim-${Date.now()}` },
    };

    await this.handleIncomingSMS(mockReq, mockRes);

    return res.status(responseStatus).json(responseData ?? { success: true });
  }
}

export default new WebhookController();
