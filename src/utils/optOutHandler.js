import User from "../models/User.js";

/**
 * Parse SMS content for opt-out keywords
 * Supports: STOP, UNSUBSCRIBE, OPT-OUT
 * Case-insensitive
 * @param {string} content - SMS content
 * @returns {boolean} - True if opt-out detected
 */
export const containsOptOutKeyword = (content) => {
  if (!content) return false;
  const text = content.trim().toUpperCase();
  return ["STOP", "UNSUBSCRIBE", "OPT-OUT", "OPTOUT"].includes(text);
};

/**
 * Handle opt-out request
 * @param {string} phone - User phone number
 * @param {string} reason - Reason for opt-out
 * @returns {Promise<Object>} - User with opt-out status updated
 */
export const handleOptOut = async (phone, reason = "User requested") => {
  try {
    const user = await User.findOneAndUpdate(
      { phone },
      {
        "optOut.isOptedOut": true,
        "optOut.reason": reason,
        "optOut.date": new Date(),
        "consent.sms": false,
      },
      { new: true },
    );
    return user;
  } catch (error) {
    console.error("Error handling opt-out:", error);
    throw error;
  }
};

/**
 * Send opt-out confirmation SMS
 * @param {string} phone - User phone number
 * @param {Object} messagingService - MessagingService instance
 * @returns {Promise<Object>} - Send result
 */
export const sendOptOutConfirmation = async (phone, messagingService) => {
  return messagingService.sendSMS({
    to: phone,
    content:
      "You have been unsubscribed from MamaCheck. If this was a mistake, contact your health worker to re-register.",
    type: "transactional",
  });
};
