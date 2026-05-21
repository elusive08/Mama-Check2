import MessageQueue from "../models/MessageQueue.js";
import termiiConfig from "../config/termii.js";
import SystemEvent from "../models/SystemEvent.js";
import axios from "axios";

class MessagingService {
  constructor() {
    this.termiiApiKey = termiiConfig.apiKey;
    this.senderId = termiiConfig.senderId;
    // Check if we're in test environment
    this.isTestEnvironment =
      process.env.NODE_ENV === "test" ||
      process.env.MOCK_SMS_SERVICE === "true";
  }

  /**
   * Queue a message for sending
   * @param {Object} messageData - Message details
   * @returns {Promise<Object>} Queued message
   */
  async queueMessage(messageData) {
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

    return await message.save();
  }

  /**
   * Send SMS via Termii
   * @param {Object} message - Message object
   * @returns {Promise<Object>} Send result
   */
  async sendSMS(message) {
    try {
      // In test environment, don't actually call Termii API
      if (this.isTestEnvironment) {
        console.log(`[MOCK] Sending SMS to ${message.to}: ${message.content}`);

        // Update message status for mock
        message.status = "delivered";
        message.sentAt = new Date();
        message.deliveredAt = new Date();
        message.metadata = message.metadata || {};
        message.metadata.termiiMessageId = `mock-${Date.now()}`;
        await message.save();

        return {
          success: true,
          messageId: `mock-${Date.now()}`,
          to: message.to,
          mock: true,
        };
      }

      // Real Termii API call for production/development
      const response = await axios.post("https://api.termii.com/api/sms/send", {
        to: message.to,
        from: this.senderId,
        sms: message.content,
        type: "plain",
        channel: "generic",
        api_key: this.termiiApiKey,
      });

      // Update message status
      message.status = "delivered";
      message.sentAt = new Date();
      message.deliveredAt = new Date();
      message.metadata.termiiMessageId = response.data.message_id;
      await message.save();

      return {
        success: true,
        messageId: response.data.message_id,
        to: message.to,
      };
    } catch (error) {
      console.error("SMS send failed:", error);

      // Handle retry logic
      message.retryCount += 1;

      if (message.retryCount >= message.maxRetries) {
        message.status = "failed";
        message.error = error.message;
        await message.save();

        // Log to system events
        await this.logFailedMessage(message, error);
      } else {
        // Reschedule for retry (exponential backoff)
        const backoffMinutes = Math.pow(2, message.retryCount);
        message.scheduledFor = new Date(Date.now() + backoffMinutes * 60000);
        await message.save();
      }

      return {
        success: false,
        error: error.message,
        retryCount: message.retryCount,
      };
    }
  }

  /**
   * Process message queue
   * @returns {Promise<Array>} Processing results
   */
  async processQueue() {
    const dueMessages = await MessageQueue.find({
      status: "queued",
      scheduledFor: { $lte: new Date() },
    })
      .sort({ priority: -1, scheduledFor: 1 })
      .limit(100);

    const results = [];

    for (const message of dueMessages) {
      message.status = "sending";
      await message.save();

      const result = await this.sendSMS(message);
      results.push(result);

      // Rate limiting: wait 100ms between messages (skip in test)
      if (!this.isTestEnvironment) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Format message using template
   * @param {Object} template - Message template
   * @param {Object} variables - Template variables
   * @returns {string} Formatted message
   */
  formatTemplate(template, variables) {
    let message = template.content;

    for (const [key, value] of Object.entries(variables)) {
      message = message.replace(new RegExp(`{{${key}}}`, "g"), value);
    }

    // Ensure message fits SMS character limit
    if (message.length > 160) {
      message = message.substring(0, 157) + "...";
    }

    return message;
  }

  async logFailedMessage(message, error) {
    await SystemEvent.create({
      type: "SMS_FAILURE",
      severity: "HIGH",
      message: `SMS delivery failed for ${message.to}`,
      details: {
        messageId: message._id,
        error: error.message,
        retryCount: message.retryCount,
      },
    });
  }

  /**
   * Send bulk messages
   * @param {Array} messages - Array of message objects
   * @returns {Promise<Array>} Results
   */
  async sendBulk(messages) {
    const queuedMessages = [];

    for (const message of messages) {
      const queued = await this.queueMessage(message);
      queuedMessages.push(queued);
    }

    return queuedMessages;
  }
}

export default new MessagingService();
