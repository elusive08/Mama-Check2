/**
 * services/messagingService — MessagingService
 *
 * High-level SMS service: queue, send, retry, bulk dispatch, templates.
 * Delegates all actual sending to config/sms.js (SMSProvider).
 *
 * Architecture:
 *   Controller → MessagingService.queueMessage() → MessageQueue (DB)
 *                MessagingService.processQueue()  → SMSProvider.send() → BulkSMS API
 */

import MessageQueue from "../models/MessageQueue.js";
import SystemEvent from "../models/SystemEvent.js";
import smsProvider from "../config/sms.js";

// How long to wait between messages during queue processing.
// Stays within BulkSMS production rate limit (1000 req/min = ~17/sec).
const SEND_INTERVAL_MS = 100;

// Maximum messages fetched per queue-processing run.
const QUEUE_BATCH_SIZE = 100;

class MessagingService {
  constructor() {
    // Mock mode: set SMS_MOCK=true (or NODE_ENV=test) to skip real API calls
    // without needing to swap provider config.
    this.mock =
      process.env.SMS_MOCK === "true" || process.env.NODE_ENV === "test";

    if (this.mock) {
      console.info(
        "MessagingService: running in MOCK mode — no SMS will be sent",
      );
    }
  }

  // ─── Queuing ───────────────────────────────────────────────────────────────

  /**
   * Persist a message to the queue for later processing.
   *
   * @param {object} messageData
   * @param {string}  messageData.to
   * @param {string}  messageData.content       - Final message text (already rendered)
   * @param {string}  [messageData.templateId]
   * @param {string}  [messageData.language]
   * @param {string}  [messageData.type]
   * @param {'high'|'normal'|'low'} [messageData.priority='normal']
   * @param {Date}    [messageData.scheduledFor=now]
   * @param {object}  [messageData.metadata={}]
   * @returns {Promise<MessageQueue>}
   */
  async queueMessage(messageData) {
    if (!messageData.to) throw new Error("queueMessage: 'to' is required");
    if (!messageData.content)
      throw new Error("queueMessage: 'content' is required");

    const message = new MessageQueue({
      to: messageData.to,
      templateId: messageData.templateId,
      content: messageData.content,
      language: messageData.language,
      type: messageData.type,
      priority: messageData.priority || "normal",
      scheduledFor: messageData.scheduledFor || new Date(),
      metadata: messageData.metadata || {},
    });

    return message.save();
  }

  // ─── Sending ───────────────────────────────────────────────────────────────

  /**
   * Send (or mock-send) a single message object.
   * Updates the MessageQueue document in-place with the outcome.
   *
   * Accepts either a Mongoose document or a plain object.
   *
   * @param {object} message - MessageQueue doc or plain { to, content, ... }
   * @returns {Promise<{ success: boolean, messageId?: string, error?: string }>}
   */
  async sendSMS(message) {
    const isDoc = typeof message.save === "function";

    // ── Mock path ────────────────────────────────────────────────────────────
    if (this.mock) {
      const mockId = `mock-${Date.now()}`;
      console.log(`[MOCK SMS] to=${message.to} body="${message.content}"`);

      if (isDoc) {
        message.status = "delivered";
        message.sentAt = new Date();
        message.deliveredAt = new Date();
        message.metadata = { ...message.metadata, externalMessageId: mockId };
        await message.save();
      }

      return { success: true, messageId: mockId, mock: true };
    }

    // ── Real send path ───────────────────────────────────────────────────────
    // Mark as "sending" so the queue processor doesn't pick it up again
    if (isDoc && message.status !== "sending") {
      message.status = "sending";
      await message.save();
    }

    const result = await smsProvider.send(message.to, message.content, {
      // Use the default provider gateway (corporate) for all messages, including OTPs,
      // as the dedicated 'otp' gateway has shown delivery issues.
      reference: message._id?.toString(),
    });

    if (result.success) {
      if (isDoc) {
        message.status = "delivered";
        message.sentAt = new Date();
        message.deliveredAt = new Date();
        message.metadata = {
          ...message.metadata,
          externalMessageId: result.messageId,
          cost: result.cost,
          gateway: result.gateway,
          sandbox: result.sandbox,
        };
        await message.save();
      }

      return {
        success: true,
        messageId: result.messageId,
        to: message.to,
        cost: result.cost,
        sandbox: result.sandbox,
      };
    }

    // ── Failure path ─────────────────────────────────────────────────────────
    return this._handleSendFailure(message, result, isDoc);
  }

  /**
   * Handle a failed send: decide whether to retry or mark as permanently failed.
   * Uses result.retryable from the provider to avoid retrying auth/validation errors.
   */
  async _handleSendFailure(message, result, isDoc) {
    if (!isDoc) {
      // Plain object — nothing to persist, just return the failure
      return { success: false, error: result.error, bsngCode: result.bsngCode };
    }

    message.retryCount = (message.retryCount || 0) + 1;
    const maxRetries = message.maxRetries || 3;

    // Non-retryable errors (auth/validation): fail immediately regardless of retryCount
    const exhausted = message.retryCount >= maxRetries || !result.retryable;

    if (exhausted) {
      message.status = "failed";
      message.error = result.error;
      message.metadata = {
        ...message.metadata,
        bsngCode: result.bsngCode,
        failedAt: new Date().toISOString(),
      };
      await message.save();
      await this._logFailedMessage(message, result);
    } else {
      // Exponential backoff: 2^retryCount minutes (2 min, 4 min, 8 min...)
      const backoffMs = Math.pow(2, message.retryCount) * 60 * 1000;
      message.status = "queued";
      message.scheduledFor = new Date(Date.now() + backoffMs);
      await message.save();

      console.warn(
        `SMS to ${message.to} failed (attempt ${message.retryCount}/${maxRetries}). ` +
          `Retrying in ${backoffMs / 60000} min. Error: ${result.error}`,
      );
    }

    return {
      success: false,
      error: result.error,
      bsngCode: result.bsngCode,
      retryable: !exhausted,
      retryCount: message.retryCount,
    };
  }

  // ─── Queue processing ──────────────────────────────────────────────────────

  /**
   * Fetch due messages and send them in order of priority then schedule time.
   * Called by the scheduler (e.g. every 30 seconds).
   *
   * @returns {Promise<{ sent: number, failed: number, results: Array }>}
   */
  async processQueue() {
    const dueMessages = await MessageQueue.find({
      status: "queued",
      scheduledFor: { $lte: new Date() },
    })
      .sort({ priority: -1, scheduledFor: 1 })
      .limit(QUEUE_BATCH_SIZE);

    if (dueMessages.length === 0) {
      return { sent: 0, failed: 0, results: [] };
    }

    const results = [];
    let sent = 0;
    let failed = 0;

    for (const message of dueMessages) {
      // Claim the message immediately to prevent double-processing
      message.status = "sending";
      await message.save();

      const result = await this.sendSMS(message);
      results.push(result);

      if (result.success) sent++;
      else failed++;

      // Rate-limit guard — skip in mock/test mode
      if (!this.mock) {
        await new Promise((resolve) => setTimeout(resolve, SEND_INTERVAL_MS));
      }
    }

    if (sent > 0 || failed > 0) {
      console.info(
        `Queue processing complete: ${sent} sent, ${failed} failed (batch of ${dueMessages.length})`,
      );
    }

    return { sent, failed, results };
  }

  // ─── Template rendering ────────────────────────────────────────────────────

  /**
   * Render a message template by replacing {{variable}} placeholders.
   * Truncates to 160 chars with "..." suffix to stay within single-SMS billing.
   *
   * @param {{ content: string }} template
   * @param {Record<string, string>} variables
   * @returns {string}
   */
  formatTemplate(template, variables) {
    if (!template?.content)
      throw new Error("Template must have a content field");

    let message = template.content;

    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(String.raw`\{\{${key}\}\}`, "g");
      message = message.replace(regex, String(value));
    }

    if (message.length > SMS_MAX_LENGTH) {
      message = message.substring(0, 157) + "...";
    }

    return message;
  }

  // ─── Bulk queuing ──────────────────────────────────────────────────────────

  /**
   * Queue multiple messages in one call.
   * Does NOT send immediately — the queue processor handles dispatch.
   *
   * @param {Array<object>} messages
   * @returns {Promise<Array<MessageQueue>>}
   */
  async sendBulk(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("sendBulk requires a non-empty array of messages");
    }

    return Promise.all(messages.map((m) => this.queueMessage(m)));
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  async _logFailedMessage(message, result) {
    try {
      await SystemEvent.create({
        type: "SMS_FAILURE",
        severity: "HIGH",
        message: `SMS permanently failed for ${message.to}`,
        details: {
          messageId: message._id,
          error: result.error,
          bsngCode: result.bsngCode,
          retryCount: message.retryCount,
          type: message.type,
        },
      });
    } catch (logError) {
      // Don't let logging failure cascade
      console.error("Failed to log SMS_FAILURE system event:", logError);
    }
  }
}

// SMS_MAX_LENGTH used inside formatTemplate
const SMS_MAX_LENGTH = 160;

export default new MessagingService();
