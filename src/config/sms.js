/**
 * config/sms.js
 *
 * Low-level SMS provider adapter.
 * Currently supports: bulksms (BulkSMS Nigeria v2 API)
 *
 * Consumed by services/messagingService.js — do not call directly from
 * controllers or route handlers.
 */

import axios from "axios";

const SMS_MAX_LENGTH = 160;

// BulkSMS Nigeria gateway options — choose based on use case
const BULKSMS_GATEWAY = {
  DEFAULT: "direct-corporate",
  OTP: "otp",
  DUAL: "dual-backup",
};

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
};

// Nigerian network prefixes for detection
const NETWORK_PREFIXES = {
  MTN: [
    "0803",
    "0806",
    "0703",
    "0706",
    "0813",
    "0816",
    "0903",
    "0906",
    "0913",
    "0916",
  ],
  Airtel: ["0802", "0808", "0708", "0812", "0902", "0907", "0901", "0701"],
  Glo: ["0805", "0807", "0705", "0815", "0811", "0905"],
  "9mobile": ["0809", "0817", "0818", "0909", "0908"],
};

class SMSProvider {
  constructor() {
    this.provider = process.env.SMS_PROVIDER || "bulksms";
    this.isProduction = process.env.NODE_ENV === "production";
    this._initProvider();
  }

  _initProvider() {
    if (this.provider === "bulksms") {
      this._initBulkSMSProvider();
      return;
    }

    // Fallback to mock mode if no provider configured
    if (!this.isProduction) {
      console.warn(
        `Unknown SMS_PROVIDER: "${this.provider}". Falling back to mock mode.`,
      );
    }
    this.provider = "mock";
    this.mockMode = true;
  }

  _initBulkSMSProvider() {
    const isMockMode =
      process.env.SMS_MOCK === "true" || process.env.NODE_ENV === "test";

    // In production, require API key
    if (this.isProduction && !process.env.BULKSMS_API_KEY) {
      throw new Error("FATAL: BULKSMS_API_KEY is required in production");
    }

    if (!process.env.BULKSMS_API_KEY && !isMockMode) {
      throw new Error(
        "SMS provider is 'bulksms' but BULKSMS_API_KEY is not set",
      );
    }

    const isSandbox =
      !this.isProduction && process.env.BULKSMS_SANDBOX === "true";

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

    this._logProviderStatus(isSandbox, isMockMode);
  }

  _logProviderStatus(isSandbox, isMockMode) {
    if (isSandbox && !this.isProduction) {
      console.info(
        "SMS: BulkSMS running in SANDBOX mode — no real messages will be sent",
      );
    }
    if (isMockMode) {
      console.info("SMS: Running in MOCK mode — no messages will be sent");
    }
    if (this.isProduction && !isSandbox) {
      console.info("SMS: BulkSMS running in PRODUCTION mode");
    }
  }

  /**
   * Detect mobile network from phone number
   */
  detectNetwork(phone) {
    try {
      const cleaned = String(phone).replace(/\D/g, "");
      for (const [network, prefixes] of Object.entries(NETWORK_PREFIXES)) {
        if (prefixes.some((prefix) => cleaned.startsWith(prefix))) {
          return network;
        }
      }
      return "Unknown";
    } catch {
      return "Unknown";
    }
  }

  /**
   * Send a single SMS with retry logic
   */
  async send(to, body, opts = {}) {
    if (!to) throw new Error("SMS recipient (to) is required");
    if (!body) throw new Error("SMS body is required");

    const network = this.detectNetwork(to);

    // Mock mode check
    if (this._isMockMode()) {
      return this._sendMock(to, body, network);
    }

    // Production validation
    if (this.isProduction) {
      this.validatePhoneNumber(to);
    }

    this._warnLongMessage(to, network, body);

    const formattedTo = this.formatNumber(to);
    return await this._sendWithRetry(formattedTo, body, opts, network);
  }

  _isMockMode() {
    return this.provider === "mock" || this.bulksmsConfig?.mock;
  }

  _sendMock(to, body, network) {
    console.log(
      `[MOCK SMS] to=${to} (${network}) body="${body.substring(0, 50)}..."`,
    );
    return {
      success: true,
      messageId: `mock-${Date.now()}`,
      mock: true,
      network,
      retryable: false,
    };
  }

  _warnLongMessage(to, network, body) {
    if (body.length > SMS_MAX_LENGTH) {
      const parts = Math.ceil(body.length / SMS_MAX_LENGTH);
      console.warn(
        `SMS to ${to} (${network}): message is ${body.length} chars (${parts} parts). ` +
          "Will be delivered as a multi-part message and billed accordingly.",
      );
    }
  }

  async _sendWithRetry(to, body, opts, network) {
    let lastError;
    const startTime = Date.now();

    for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      const result = await this._attemptSend(
        to,
        body,
        opts,
        network,
        attempt,
        startTime,
      );

      if (result.success || !result.retryable) {
        return result;
      }

      lastError = result;
      if (attempt < RETRY_CONFIG.maxRetries) {
        await this._waitForRetry(attempt);
      }
    }

    return this._finalFailure(lastError, network);
  }

  async _attemptSend(to, body, opts, network, attempt, startTime) {
    try {
      const result = await this._sendBulkSMS(to, body, opts);
      result.network = network;
      result.attempt = attempt;
      result.durationMs = Date.now() - startTime;

      if (result.success) {
        console.log(
          `SMS to ${to} (${network}) sent successfully on attempt ${attempt} (${result.durationMs}ms)`,
        );
        if (result.sandbox) {
          console.warn(
            `⚠️ SMS sent in SANDBOX mode — message not actually delivered to ${to}`,
          );
        }
      }
      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        retryable: true,
        network,
        attempt,
      };
    }
  }

  async _waitForRetry(attempt) {
    const delay = Math.min(
      RETRY_CONFIG.baseDelay * Math.pow(2, attempt - 1),
      RETRY_CONFIG.maxDelay,
    );
    console.warn(`Retrying in ${delay}ms...`);
    await this._delay(delay);
  }

  _finalFailure(lastError, network) {
    console.error(
      `SMS failed after ${RETRY_CONFIG.maxRetries} attempts:`,
      lastError.error,
    );
    return {
      success: false,
      error: lastError.error,
      retryable: false,
      network,
      attemptsExhausted: true,
    };
  }

  validatePhoneNumber(phone) {
    const cleaned = String(phone).replace(/\D/g, "");
    if (cleaned.length < 10 || cleaned.length > 13) {
      console.warn(`Suspicious phone number format: ${phone}`);
    }
  }

  _delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ─── BulkSMS Nigeria v2 ────────────────────────────────────────────────────

  async _sendBulkSMS(to, body, opts = {}) {
    const payload = this._buildPayload(to, body, opts);
    const timeout = opts.gateway === "otp" ? 15000 : 30000;

    let response;
    try {
      response = await axios.post(
        `${this.bulksmsConfig.baseUrl}/sms`,
        payload,
        {
          timeout,
          headers: this._getHeaders(),
        },
      );
      this._logApiResponse(response.data);
    } catch (axiosError) {
      return this._handleAxiosError(axiosError);
    }

    const data = response.data;
    if (data?.status === "success") {
      return this._buildSuccessResponse(data);
    }

    return this._handleBulkSMSError(data);
  }

  _buildPayload(to, body, opts) {
    const payload = {
      from: this.bulksmsConfig.sender,
      to,
      body,
      gateway: opts.gateway || this.bulksmsConfig.gateway,
    };

    const callback = opts.callbackUrl || process.env.BULKSMS_CALLBACK_URL;
    if (callback) {
      payload.callback_url = callback;
    }
    if (opts.reference) {
      payload.customer_reference = opts.reference;
    }

    return payload;
  }

  _getHeaders() {
    return {
      Authorization: `Bearer ${this.bulksmsConfig.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  _logApiResponse(data) {
    if (process.env.NODE_ENV !== "production") {
      console.log("BulkSMS API Response:", JSON.stringify(data, null, 2));
    }
    if (data?.data?.delivery_status) {
      console.log(`BulkSMS delivery status: ${data.data.delivery_status}`);
    }
  }

  _handleAxiosError(error) {
    if (error.code === "ECONNABORTED") {
      return { success: false, error: "Request timeout", retryable: true };
    }
    if (error.response?.data) {
      return this._handleBulkSMSError(error.response.data);
    }
    return { success: false, error: error.message, retryable: true };
  }

  _buildSuccessResponse(data) {
    return {
      success: true,
      messageId: data.data?.message_id,
      cost: data.data?.cost,
      currency: data.data?.currency ?? "NGN",
      recipientsCount: data.data?.recipients_count,
      gateway: data.data?.gateway_used,
      sandbox: data.data?.sandbox_mode ?? this.bulksmsConfig.sandbox,
      deliveryStatus: data.data?.delivery_status,
      retryable: false,
    };
  }

  /**
   * Map BulkSMS BSNG-XXXX error codes to structured failures
   */
  _handleBulkSMSError(data) {
    const bsngCode = data?.code || data?.error?.code || "BSNG-UNKNOWN";
    const message =
      data?.error?.message || data?.message || "Unknown BulkSMS error";

    console.error(`BulkSMS error [${bsngCode}]:`, message);
    if (data?.error?.details) {
      console.error("Error details:", data.error.details);
    }

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
    // Server errors (5xxx), gateway timeout (3006), network errors (2xxx)
    return (
      numeric >= 5000 || numeric === 3006 || (numeric >= 2000 && numeric < 3000)
    );
  }

  // ─── Phone number normalisation ────────────────────────────────────────────

  formatNumber(phone) {
    if (!phone) throw new Error("Phone number is required");

    let cleaned = String(phone).replace(/\D/g, "");

    if (cleaned.startsWith("234")) {
      if (cleaned.length !== 13) {
        throw new Error(
          `Invalid Nigerian number (expected 13 digits): ${phone}`,
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

  // ─── Account management ────────────────────────────────────────────────────

  async checkBalance() {
    if (this.provider !== "bulksms" || this.bulksmsConfig?.mock) {
      return { supported: false, mock: true };
    }

    try {
      const response = await axios.get(
        `${this.bulksmsConfig.baseUrl}/balance`,
        {
          timeout: 10000,
          headers: this._getHeaders(),
        },
      );
      const d = response.data?.data;

      if (this.isProduction && d?.balance < 1000) {
        console.warn(
          `⚠️ Low SMS balance: ₦${d?.balance?.toFixed(2) || "Unknown"}`,
        );
      }

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

  async getDeliveryStatus(messageId) {
    if (!messageId || this.bulksmsConfig?.mock) {
      return { success: false, error: "No message ID or mock mode" };
    }

    try {
      const response = await axios.get(
        `${this.bulksmsConfig.baseUrl}/sms/${messageId}`,
        {
          timeout: 10000,
          headers: this._getHeaders(),
        },
      );

      return {
        success: true,
        status: response.data?.data?.status,
        deliveryStatus: response.data?.data?.delivery_status,
        deliveredAt: response.data?.data?.delivered_at,
      };
    } catch (error) {
      console.error(
        `Failed to get delivery status for ${messageId}:`,
        error.message,
      );
      return { success: false, error: error.message };
    }
  }
}

export default new SMSProvider();
