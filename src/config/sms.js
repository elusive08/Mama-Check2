/**
 * config/sms.js
 *
 * Low-level SMS provider adapter.
 * Currently supports: bulksms (BulkSMS Nigeria v2 API), twilio (legacy/fallback).
 *
 * Consumed by services/sms.js (MessagingService) — do not call directly from
 * controllers or route handlers.
 */

import axios from "axios";
import twilio from "twilio";

const SMS_MAX_LENGTH = 160;

// BulkSMS Nigeria gateway options — choose based on use case
const BULKSMS_GATEWAY = {
  DEFAULT: "direct-corporate", // Highest deliverability
  OTP: "otp", // Low-latency, for time-sensitive OTPs
  DUAL: "dual-backup", // Failover to second gateway automatically
};

class SMSProvider {
  constructor() {
    this.provider = process.env.SMS_PROVIDER || "bulksms";
    this._initProvider();
  }

  _initProvider() {
    if (this.provider === "bulksms") {
      if (!process.env.BULKSMS_API_KEY) {
        throw new Error(
          "SMS provider is 'bulksms' but BULKSMS_API_KEY is not set",
        );
      }

      const isSandbox =
        process.env.NODE_ENV !== "production" ||
        process.env.BULKSMS_SANDBOX === "true";

      this.bulksmsConfig = {
        apiKey: process.env.BULKSMS_API_KEY,
        sender: process.env.BULKSMS_SENDER_ID || "MamaCheck",
        baseUrl: isSandbox
          ? "https://www.bulksmsnigeria.com/api/sandbox/v2"
          : "https://www.bulksmsnigeria.com/api/v2",
        gateway: process.env.BULKSMS_GATEWAY || BULKSMS_GATEWAY.DEFAULT,
        sandbox: isSandbox,
      };

      if (isSandbox) {
        console.info(
          "SMS: BulkSMS running in SANDBOX mode — no real messages will be sent",
        );
      }
      return;
    }

    if (this.provider === "twilio") {
      if (
        !process.env.TWILIO_ACCOUNT_SID ||
        !process.env.TWILIO_AUTH_TOKEN ||
        !process.env.TWILIO_PHONE_NUMBER
      ) {
        throw new Error(
          "SMS provider is 'twilio' but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER are not set",
        );
      }
      this.twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
      );
      this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
      return;
    }

    throw new Error(
      `Unknown SMS_PROVIDER: "${this.provider}". Valid values: 'bulksms', 'twilio'`,
    );
  }

  /**
   * Send a single SMS.
   *
   * @param {string} to       - Recipient phone (any common Nigerian format)
   * @param {string} body     - Message text
   * @param {object} [opts]   - { gateway, callbackUrl, reference }
   * @returns {Promise<{ success: boolean, messageId?: string, cost?: number, sandbox?: boolean, retryable?: boolean, error?: string, bsngCode?: string }>}
   */
  async send(to, body, opts = {}) {
    if (!to) throw new Error("SMS recipient (to) is required");
    if (!body) throw new Error("SMS body is required");

    if (body.length > SMS_MAX_LENGTH) {
      console.warn(
        `SMS to ${to}: message is ${body.length} chars (>${SMS_MAX_LENGTH}). ` +
          "Will be delivered as a multi-part message and billed accordingly.",
      );
    }

    const formattedTo = this.formatNumber(to);

    try {
      if (this.provider === "bulksms") {
        return await this._sendBulkSMS(formattedTo, body, opts);
      }
      return await this._sendTwilio(formattedTo, body);
    } catch (error) {
      console.error(`SMS send failed to ${formattedTo}:`, error.message);
      return { success: false, error: error.message, retryable: true };
    }
  }

  // ─── BulkSMS Nigeria v2 ────────────────────────────────────────────────────

  async _sendBulkSMS(to, body, opts = {}) {
    const { gateway, callbackUrl, reference } = opts;

    const payload = {
      from: this.bulksmsConfig.sender,
      to,
      body,
      gateway: gateway || this.bulksmsConfig.gateway,
    };

    if (callbackUrl) payload.callback_url = callbackUrl;
    if (reference) payload.customer_reference = reference;

    let response;
    try {
      response = await axios.post(
        `${this.bulksmsConfig.baseUrl}/sms`,
        payload,
        {
          timeout: 15000,
          headers: {
            Authorization: `Bearer ${this.bulksmsConfig.apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        },
      );
    } catch (axiosError) {
      if (axiosError.response?.data) {
        return this._handleBulkSMSError(axiosError.response.data);
      }
      // Network / timeout — retryable
      throw axiosError;
    }

    const data = response.data;

    if (data?.status === "success") {
      return {
        success: true,
        messageId: data.data?.message_id,
        cost: data.data?.cost,
        currency: data.data?.currency ?? "NGN",
        recipientsCount: data.data?.recipients_count,
        gateway: data.data?.gateway_used,
        sandbox: data.data?.sandbox_mode ?? this.bulksmsConfig.sandbox,
        retryable: false,
      };
    }

    return this._handleBulkSMSError(data);
  }

  /**
   * Map BulkSMS BSNG-XXXX error codes to structured failures.
   * MessagingService uses `retryable` to decide whether to schedule a retry:
   *   - 5xxx + BSNG-3006 (gateway down) → retryable
   *   - 1xxx (auth), 2xxx (validation), 3001-3005 (business) → not retryable
   */
  _handleBulkSMSError(data) {
    const bsngCode = data?.code || data?.error?.code || "BSNG-UNKNOWN";
    const message =
      data?.error?.message || data?.message || "Unknown BulkSMS error";

    console.error(`BulkSMS error [${bsngCode}]:`, message);

    return {
      success: false,
      error: message,
      bsngCode,
      retryable: this._isRetryable(bsngCode),
    };
  }

  _isRetryable(bsngCode) {
    if (!bsngCode || bsngCode === "BSNG-UNKNOWN") return true;
    const numeric = Number.parseInt(bsngCode.replace("BSNG-", ""), 10);
    return numeric >= 5000 || numeric === 3006;
  }

  // ─── Twilio (legacy) ───────────────────────────────────────────────────────

  async _sendTwilio(to, body) {
    const e164 = to.startsWith("+") ? to : `+${to}`;
    const response = await this.twilioClient.messages.create({
      body,
      to: e164,
      from: this.fromNumber,
    });
    return {
      success: true,
      messageId: response.sid,
      gateway: "twilio",
      sandbox: false,
      retryable: false,
    };
  }

  // ─── Phone number normalisation ────────────────────────────────────────────

  /**
   * Normalize to Nigerian international format without + prefix.
   * Accepted: 08012345678 | 8012345678 | +2348012345678 | 2348012345678
   * Returns:  "2348012345678"
   */
  formatNumber(phone) {
    if (!phone) throw new Error("Phone number is required");

    let cleaned = String(phone).replace(/\D/g, "");

    if (cleaned.startsWith("234")) {
      if (cleaned.length !== 13) {
        throw new Error(
          `Invalid Nigerian number (expected 13 digits after stripping): ${phone}`,
        );
      }
      return cleaned;
    }

    if (cleaned.startsWith("0")) {
      cleaned = "234" + cleaned.substring(1);
      if (cleaned.length !== 13) {
        throw new Error(
          `Invalid Nigerian number (local format, expected 11 digits): ${phone}`,
        );
      }
      return cleaned;
    }

    if (cleaned.length === 10) {
      return "234" + cleaned;
    }

    throw new Error(`Unrecognized phone number format: ${phone}`);
  }

  /**
   * Check BulkSMS account balance.
   * Call from a health-check endpoint or a low-balance cron alert.
   */
  async checkBalance() {
    if (this.provider !== "bulksms") return { supported: false };

    try {
      const response = await axios.get(
        `${this.bulksmsConfig.baseUrl}/balance`,
        {
          timeout: 10000,
          headers: {
            Authorization: `Bearer ${this.bulksmsConfig.apiKey}`,
            Accept: "application/json",
          },
        },
      );
      const d = response.data?.data;
      return {
        supported: true,
        balance: d?.balance,
        currency: d?.currency ?? "NGN",
        formatted: d?.formatted,
        sandbox: this.bulksmsConfig.sandbox,
      };
    } catch (error) {
      console.error("BulkSMS balance check failed:", error.message);
      return { supported: true, error: error.message };
    }
  }
}

export default new SMSProvider();
