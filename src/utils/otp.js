import otpStore from "./otpStore.js";

/**
 * Verify an OTP for a given phone number
 * @param {string} phone - Phone number
 * @param {string} otp - OTP to verify
 * @returns {Promise<boolean>} True if OTP is valid, false otherwise
 */
export const verifyOTP = async (phone, otp) => {
  try {
    const storedOTP = await otpStore.get(phone);

    if (!storedOTP) {
      return false;
    }

    if (storedOTP.verified === false && storedOTP.otp === otp) {
      // Mark as verified
      storedOTP.verified = true;
      await otpStore.set(phone, storedOTP, 300); // Keep for 5 more minutes
      return true;
    }

    return false;
  } catch (error) {
    console.error("OTP verification error:", error);
    return false;
  }
};

/**
 * Check if OTP is verified
 * @param {string} phone - Phone number
 * @returns {Promise<boolean>} True if OTP is verified
 */
export const isOTPVerified = async (phone) => {
  try {
    const storedOTP = await otpStore.get(phone);
    return storedOTP?.verified === true;
  } catch (error) {
    console.error("OTP check error:", error);
    return false;
  }
};

/**
 * Clear OTP after successful use
 * @param {string} phone - Phone number
 */
export const clearOTP = async (phone) => {
  try {
    await otpStore.delete(phone);
  } catch (error) {
    console.error("OTP clear error:", error);
  }
};
