import mongoose from "mongoose";

const dangerReportSchema = new mongoose.Schema(
  {
    pregnancyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pregnancy",
      required: true,
      index: true,
    },
    womanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    chewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CHEWProfile",
      required: false,
    },
    reportedSymptoms: [
      {
        type: Number,
        enum: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      },
    ],
    symptomDescriptions: [String],
    triageOutcome: {
      type: String,
      enum: ["GREEN", "YELLOW", "RED"],
      required: true,
    },
    triageMessage: String,
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
    source: {
      type: String,
      enum: ["sms", "ussd", "whatsapp", "dashboard"],
      default: "sms",
    },
    messageId: String,
    requiresFollowup: {
      type: Boolean,
      default: false,
    },
    chewAlerted: {
      type: Boolean,
      default: false,
    },
    chewAlertTime: Date,
    trustedAlerted: {
      type: Boolean,
      default: false,
    },
    trustedAlertTime: Date,
    followup: {
      status: {
        type: String,
        enum: [
          "pending",
          "in_progress",
          "completed",
          "escalated",
          "unable_to_reach",
        ],
        default: "pending",
      },
      outcome: {
        type: String,
        enum: [
          "phone_contact",
          "clinic_visit",
          "referral_hospital",
          "unable_to_reach",
        ],
      },
      notes: String,
      completedBy: mongoose.Schema.Types.ObjectId,
      completedAt: Date,
      escalationLevel: {
        type: Number,
        default: 0,
      },
    },
    clinicalOutcome: {
      type: String,
      enum: ["resolved", "hospitalized", "delivered", "miscarried", "unknown"],
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for reporting
dangerReportSchema.index({ timestamp: -1, triageOutcome: 1 });
dangerReportSchema.index({ chewId: 1, "followup.status": 1 });
dangerReportSchema.index({ pregnancyId: 1, timestamp: -1 });

// Static methods
dangerReportSchema.statics.getOpenRedFlags = async function (chewId) {
  return this.find({
    chewId,
    triageOutcome: "RED",
    "followup.status": "pending",
  }).populate("womanId", "name phone");
};

export default mongoose.model("DangerReport", dangerReportSchema);
