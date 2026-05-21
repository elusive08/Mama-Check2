import axios from "axios";
import otpStore from "./otpStore.js";

const TERMII_API_KEY = process.env.TERMII_API_KEY;
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || "MamaCheck";
const TERMII_BASE_URL = process.env.TERMII_BASE_URL || "https://api.termii.com";

export const sendOTP = async (phone) => {
  let otp;
  try {
    // Format phone number (ensure it's in international format)
    let formattedPhone = phone;
    if (phone.startsWith("0")) {
      formattedPhone = "234" + phone.substring(1);
    }
    if (!formattedPhone.startsWith("234")) {
      formattedPhone = "234" + formattedPhone;
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP
    await otpStore.set(
      phone,
      {
        otp,
        attempts: 0,
        verified: false,
        createdAt: Date.now(),
      },
      300,
    );

    // For testing without Termii
    if (
      process.env.NODE_ENV === "development" &&
      TERMII_API_KEY === "test_mode"
    ) {
      console.log(`📱 [TEST MODE] OTP for ${phone}: ${otp}`);
      return { success: true, messageId: `test-${Date.now()}`, isTest: true };
    }

    // Send via Termii
    const payload = {
      to: formattedPhone,
      from: TERMII_SENDER_ID,
      sms: `Your MamaCheck verification code is: ${otp}. Valid for 5 minutes.`,
      type: "plain",
      api_key: TERMII_API_KEY,
      channel: "generic",
    };

    console.log("📤 Sending OTP via Termii to:", formattedPhone);

    const response = await axios.post(
      `${TERMII_BASE_URL}/api/sms/send`,
      payload,
      { timeout: 10000 },
    );

    if (response.data.code === "ok" || response.data.message_id) {
      console.log(`✅ OTP sent successfully to ${phone}`);
      return { success: true, messageId: response.data.message_id };
    } else {
      throw new Error(response.data.message || "Termii returned error");
    }
  } catch (error) {
    console.error(
      "❌ Termii OTP error:",
      error.response?.data || error.message,
    );

    // Fallback for production - log OTP for debugging
    console.log(`📱 [FALLBACK] OTP for ${phone} would be: ${otp || "N/A"}`);

    return {
      success: false,
      error:
        error.response?.data?.message || error.message || "Failed to send OTP",
    };
  }
};
