/**
 * config/sms.js
 *
 * Low-level SMS provider adapter.
 * Currently supports: bulksms (BulkSMS Nigeria v2 API)
 *
 * Consumed by services/sms.js (MessagingService) — do not call directly from
 * controllers or route handlers.
 */

import axios from "axios";

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
      // Allow mock mode for testing without API key
      const isMockMode =
        process.env.SMS_MOCK === "true" || process.env.NODE_ENV === "test";

      if (!process.env.BULKSMS_API_KEY && !isMockMode) {
        throw new Error(
          "SMS provider is 'bulksms' but BULKSMS_API_KEY is not set",
        );
      }

      const isSandbox =
        process.env.NODE_ENV !== "production" ||
        process.env.BULKSMS_SANDBOX === "true";

      this.bulksmsConfig = {
        apiKey: process.env.BULKSMS_API_KEY || "mock-key",
        sender: process.env.BULKSMS_SENDER_ID || "MamaCheck",
        baseUrl: isSandbox
          ? "https://www.bulksmsnigeria.com/api/sandbox/v2"
          : "https://www.bulksmsnigeria.com/api/v2",
        gateway: process.env.BULKSMS_GATEWAY || BULKSMS_GATEWAY.DEFAULT,
        sandbox: isSandbox,
        mock: isMockMode,
      };

      if (isSandbox) {
        console.info(
          "SMS: BulkSMS running in SANDBOX mode — no real messages will be sent",
        );
      }
      if (isMockMode) {
        console.info("SMS: Running in MOCK mode — no messages will be sent");
      }
      return;
    }

    // Fallback to mock mode if no provider configured
    console.warn(
      `Unknown SMS_PROVIDER: "${this.provider}". Falling back to mock mode.`,
    );
    this.provider = "mock";
    this.mockMode = true;
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

    // Mock mode - just log and return success
    if (this.provider === "mock" || this.bulksmsConfig?.mock) {
      console.log(`[MOCK SMS] to=${to} body="${body.substring(0, 50)}..."`);
      return {
        success: true,
        messageId: `mock-${Date.now()}`,
        mock: true,
        retryable: false,
      };
    }

    if (body.length > SMS_MAX_LENGTH) {
      console.warn(
        `SMS to ${to}: message is ${body.length} chars (>${SMS_MAX_LENGTH}). ` +
          "Will be delivered as a multi-part message and billed accordingly.",
      );
    }

    const formattedTo = this.formatNumber(to);

    try {
      return await this._sendBulkSMS(formattedTo, body, opts);
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
          timeout: 30000,
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
    if (this.provider !== "bulksms" || this.bulksmsConfig?.mock) {
      return { supported: false, mock: true };
    }

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
