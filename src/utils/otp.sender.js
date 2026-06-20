import messagingService from "../services/messagingService.js";
import otpStore from "./otpStore.js";

export const sendOTP = async (phone) => {
  let otp;
  try {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed ambiguous chars like 0, O, 1, I
    otp = "";
    for (let i = 0; i < 6; i++) {
      otp += chars.charAt(Math.floor(Math.random() * chars.length));
    }

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

    const messageContent = `Your MamaCheck verification code is: ${otp}. Valid for 5 minutes.`;

    console.log("📤 Sending OTP via MessagingService to:", phone);

    // Use MessagingService to send SMS
    const messageObject = {
      to: phone,
      content: messageContent,
      type: "otp",
      metadata: {},
      retryCount: 0,
      maxRetries: 3,
    };

    const result = await messagingService.sendSMS(messageObject);

    if (result.success) {
      console.log(`✅ OTP sent successfully to ${phone}`);
      return { success: true, messageId: result.messageId };
    } else {
      throw new Error(result.error || "Failed to send OTP");
    }
  } catch (error) {
    console.error("❌ OTP sending error:", error.message);

    // Fallback for debugging
    console.log(`📱 [FALLBACK] OTP for ${phone} would be: ${otp || "N/A"}`);

    return {
      success: false,
      error: error.message || "Failed to send OTP",
    };
  }
};
