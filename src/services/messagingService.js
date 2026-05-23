import MessageQueue from "../models/MessageQueue.js";
import config from "../config/index.js";
import SystemEvent from "../models/SystemEvent.js";
import twilio from "twilio";

class MessagingService {
  constructor() {
    this.accountSid = config.twilio.accountSid;
    this.authToken = config.twilio.authToken;
    this.fromNumber = config.twilio.phoneNumber;

    console.log("DEBUG: MessagingService constructor", {
      hasAccountSid: !!this.accountSid,
      hasAuthToken: !!this.authToken,
      nodeEnv: process.env.NODE_ENV,
      mockSmsService: process.env.MOCK_SMS_SERVICE
    });

    // Initialize Twilio client if credentials are provided
    if (this.accountSid && this.authToken) {
      try {
        this.client = twilio(this.accountSid, this.authToken);
        console.log("DEBUG: Twilio client initialized successfully");
      } catch (err) {
        console.error("DEBUG: Failed to initialize Twilio client", err);
      }
    } else {
      console.log("DEBUG: Twilio credentials missing, client not initialized");
    }

    // Check if we're in test environment
    this.isTestEnvironment =
      process.env.NODE_ENV === "test" ||
      process.env.MOCK_SMS_SERVICE === "true";
    
    console.log("DEBUG: isTestEnvironment:", this.isTestEnvironment);
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
   * Send SMS via Twilio
   * @param {Object} message - Message object
   * @returns {Promise<Object>} Send result
   */
  async sendSMS(message) {
    try {
      // In test environment, don't actually call Twilio API
      if (this.isTestEnvironment || !this.client) {
        console.log(`[MOCK] Sending SMS to ${message.to}: ${message.content}`);

        // Update message status for mock
        message.status = "delivered";
        message.sentAt = new Date();
        message.deliveredAt = new Date();
        message.metadata = message.metadata || {};
        message.metadata.externalMessageId = `mock-${Date.now()}`;
        
        if (typeof message.save === "function") {
          await message.save();
        }

        return {
          success: true,
          messageId: `mock-${Date.now()}`,
          to: message.to,
          mock: true,
        };
      }

      // Format phone number for Twilio (E.164 format)
      let formattedPhone = message.to;
      if (!formattedPhone.startsWith("+")) {
        if (formattedPhone.startsWith("0")) {
          // Assume Nigeria (234) if starts with 0
          formattedPhone = "+234" + formattedPhone.substring(1);
        } else {
          // Add + if missing
          formattedPhone = "+" + formattedPhone;
        }
      }

      // Real Twilio API call
      const response = await this.client.messages.create({
        body: message.content,
        to: formattedPhone,
        from: this.fromNumber,
      });

      // Update message status
      message.status = "delivered";
      message.sentAt = new Date();
      message.deliveredAt = new Date();
      message.metadata = message.metadata || {};
      message.metadata.externalMessageId = response.sid;
      
      if (typeof message.save === "function") {
        await message.save();
      }

      return {
        success: true,
        messageId: response.sid,
        to: message.to,
        status: response.status,
      };
    } catch (error) {
      console.error("SMS send failed:", error);

      // Handle retry logic
      if (message) {
        message.retryCount = (message.retryCount || 0) + 1;

        if (message.retryCount >= (message.maxRetries || 3)) {
          message.status = "failed";
          message.error = error.message;
          
          if (typeof message.save === "function") {
            await message.save();
          }

          // Log to system events
          await this.logFailedMessage(message, error);
        } else {
          // Reschedule for retry (exponential backoff)
          const backoffMinutes = Math.pow(2, message.retryCount);
          message.scheduledFor = new Date(Date.now() + backoffMinutes * 60000);
          
          if (typeof message.save === "function") {
            await message.save();
          }
        }
      }

      return {
        success: false,
        error: error.message,
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
    try {
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
    } catch (logError) {
      console.error("Failed to log system event:", logError);
    }
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
