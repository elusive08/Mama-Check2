import mongoose from "mongoose";

const pregnancySchema = new mongoose.Schema(
  {
    womanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    chewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CHEWProfile",
      required: true,
    },
    phcId: {
      type: String,
      required: true,
      index: true,
    },
    lmp: Date,
    edd: Date,
    gestationalWeek: {
      type: Number,
      min: 0,
      max: 42,
    },
    parity: Number,
    gravida: Number,
    riskFactors: [String],
    status: {
      type: String,
      enum: ["pending_verification", "active", "delivered", "miscarried", "transferred"],
      default: "pending_verification",
    },
    registrationDate: {
      type: Date,
      default: Date.now,
    },
    ancVisits: [
      {
        weekNumber: Number,
        scheduledDate: Date,
        attendedDate: Date,
        status: {
          type: String,
          enum: ["scheduled", "attended", "missed", "rescheduled"],
          default: "scheduled",
        },
        notes: String,
      },
    ],
    lastCheckin: Date,
    nextCheckin: Date,
    consent: {
      sms: {
        type: Boolean,
        default: true,
      },
      trustedContact: {
        type: Boolean,
        default: true,
      },
    },
    metadata: {
      registrationMethod: {
        type: String,
        enum: ["chew_dashboard", "ussd", "api"],
        default: "chew_dashboard",
      },
      deviceInfo: String,
      ipAddress: String,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for performance
pregnancySchema.index({ chewId: 1, status: 1 });
pregnancySchema.index({ nextCheckin: 1 });
pregnancySchema.index({ gestationalWeek: 1 });

export default mongoose.model("Pregnancy", pregnancySchema);
