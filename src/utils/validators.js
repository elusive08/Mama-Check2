class Validators {
  validatePhoneNumber(phone) {
    // Nigerian phone number validation
    const nigerianPhoneRegex = /^(0|234|\+234)?[789][01]\d{8}$/;
    return nigerianPhoneRegex.test(phone);
  }

  normalizePhoneNumber(phone) {
    // Convert to international format
    let normalized = phone.replace(/\s+/g, "");
    if (normalized.startsWith("0")) {
      normalized = "234" + normalized.substring(1);
    } else if (normalized.startsWith("+234")) {
      normalized = normalized.substring(1);
    } else if (!normalized.startsWith("234")) {
      normalized = "234" + normalized;
    }
    return normalized;
  }

  validateLMP(lmp) {
    // Accept dates from past 2 years for flexibility in pregnancy tracking
    const lmpDate = new Date(lmp);
    const today = new Date();
    const maxDaysAgo = 730; // ~2 years
    const daysDifference = (today - lmpDate) / (1000 * 60 * 60 * 24);

    return (
      !Number.isNaN(lmpDate.getTime()) &&
      daysDifference >= 0 &&
      daysDifference <= maxDaysAgo
    );
  }

  validateEDD(edd) {
    const eddDate = new Date(edd);
    const today = new Date();
    const maxDaysFromNow = 280; // 40 weeks
    const daysDifference = (eddDate - today) / (1000 * 60 * 60 * 24);

    return daysDifference >= 0 && daysDifference <= maxDaysFromNow;
  }

  validateAge(dob) {
    const age = Math.floor(
      (Date.now() - new Date(dob)) / (365.25 * 24 * 60 * 60 * 1000),
    );
    return age >= 12 && age <= 60;
  }

  validateSymptoms(symptoms) {
    if (!Array.isArray(symptoms)) return false;
    return symptoms.every((s) => s >= 0 && s <= 8 && Number.isInteger(s));
  }

  sanitizeInput(input) {
    if (typeof input !== "string") return input;
    return input.trim().replace(/[<>]/g, "").substring(0, 500);
  }

  validateEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  validateParity(parity) {
    return Number.isInteger(parity) && parity >= 0 && parity <= 20;
  }
}

export default new Validators();
