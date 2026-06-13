import Joi from "joi";

// Unified Nigerian phone number regex - strict validation
const NIGERIAN_PHONE_REGEX = /^(\+?234|0)[789]\d{9}$/;

/**
 * Validates the complete patient + pregnancy registration
 * Used by POST /api/v1/pregnancies/register
 */
const validateRegistration = (req, res, next) => {
  const schema = Joi.object({
    // ========== PERSONAL INFO ==========
    firstName: Joi.string().required().min(2).max(50),
    lastName: Joi.string().required().min(2).max(50),
    phone: Joi.string().required().pattern(NIGERIAN_PHONE_REGEX),
    password: Joi.string().min(8),
    residentialAddress: Joi.string().max(200),
    lga: Joi.string(),
    state: Joi.string(),
    preferredLanguage: Joi.string().valid("en", "pidgin", "yo", "ha", "ig"),

    // ========== PREGNANCY DETAILS ==========
    lmp: Joi.date().iso(),
    edd: Joi.date().iso(),
    clinicName: Joi.string().required(),
    clinicId: Joi.string(),
    parity: Joi.number().min(0).max(20),
    gravida: Joi.number().min(0).max(20),

    // ========== TRUSTED CONTACT ==========
    trustedContactName: Joi.string().min(2).max(100),
    trustedContactPhone: Joi.string().pattern(NIGERIAN_PHONE_REGEX),
    trustedContactRelationship: Joi.string().min(2).max(50),
    trustedContactLanguage: Joi.string().valid(
      "en",
      "pidgin",
      "yo",
      "ha",
      "ig",
    ),

    // ========== OTP ==========
    otp: Joi.string().length(6),

    // ========== BACKWARD COMPATIBILITY (old format) ==========
    name: Joi.string().min(2).max(100),
    address: Joi.object({
      street: Joi.string(),
      lga: Joi.string(),
      state: Joi.string(),
    }),
    trustedContact: Joi.object({
      name: Joi.string(),
      phone: Joi.string().pattern(NIGERIAN_PHONE_REGEX),
      relationship: Joi.string(),
    }),
  })
    .xor("lmp", "edd")
    .custom((value, helpers) => {
      // If using old format (name instead of firstName/lastName)
      if (value.name && (!value.firstName || !value.lastName)) {
        const nameParts = value.name.trim().split(" ");
        value.firstName = nameParts[0] || "";
        value.lastName = nameParts.slice(1).join(" ") || "";
      }

      // Handle old address format
      if (value.address && !value.lga && value.address.lga) {
        value.lga = value.address.lga;
        value.state = value.address.state;
        value.residentialAddress =
          value.address.street || value.residentialAddress;
      }

      // Handle old trustedContact format
      if (value.trustedContact && !value.trustedContactName) {
        value.trustedContactName = value.trustedContact.name;
        value.trustedContactPhone = value.trustedContact.phone;
        value.trustedContactRelationship = value.trustedContact.relationship;
      }

      // Password is required only for new users (existing users don't need password)
      // This validation is handled in the controller, not here

      return value;
    });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
};

/**
 * Validates symptom report from SMS/USSD
 */
const validateSymptomReport = (req, res, next) => {
  const schema = Joi.object({
    symptoms: Joi.array().items(Joi.number().min(0).max(8)).min(1).required(),
    source: Joi.string().valid("sms", "ussd", "whatsapp"),
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
};

/**
 * Validates ANC visit attendance marking
 */
const validateVisitAttendance = (req, res, next) => {
  const schema = Joi.object({
    pregnancyId: Joi.string().required(),
    milestoneNumber: Joi.number().min(1).max(8).required(),
    attendedDate: Joi.date().iso(),
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
};

export {
  validateRegistration,
  validateSymptomReport,
  validateVisitAttendance,
  NIGERIAN_PHONE_REGEX,
};
