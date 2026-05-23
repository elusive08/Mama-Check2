import messagingService from "../services/messagingService.js";
import otpStore from "./otpStore.js";

export const sendOTP = async (phone) => {
  let otp;
  try {
    otp = Math.floor(100000 + Math.random() * 900000).toString();

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
    const result = await messagingService.sendSMS({
      to: phone,
      content: messageContent,
      type: "otp",
      save: () => Promise.resolve(), // Mock save if sendSMS expects a mongoose document
      metadata: {},
      retryCount: 0,
      maxRetries: 3,
    });

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
