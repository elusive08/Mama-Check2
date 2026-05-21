import Joi from "joi";

const validateRegistration = (req, res, next) => {
  const schema = Joi.object({
    name: Joi.string().required().min(2).max(100),
    phone: Joi.string()
      .required()
      .pattern(/^\d{10,14}$/),
    address: Joi.object({
      street: Joi.string(),
      lga: Joi.string().required(),
      state: Joi.string().required(),
    }),
    preferredLanguage: Joi.string().valid("en", "pidgin", "yo", "ha", "ig"),
    lmp: Joi.date().iso(),
    edd: Joi.date().iso(),
    clinicName: Joi.string().required(),
    clinicId: Joi.string(),
    parity: Joi.number().min(0).max(20),
    gravida: Joi.number().min(0).max(20),
    trustedContact: Joi.object({
      name: Joi.string(),
      phone: Joi.string().pattern(/^\d{10,14}$/),
      relationship: Joi.string(),
    }),
    otp: Joi.string().length(6).required(),
  }).xor("lmp", "edd");

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
};

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

export { validateRegistration, validateSymptomReport, validateVisitAttendance };
