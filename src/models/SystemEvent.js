import mongoose from "mongoose";

const systemEventSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "SCHEDULER_FAILURE",
        "SMS_FAILURE",
        "WEBHOOK_ERROR",
        "DATABASE_ERROR",
        "AUTH_FAILURE",
        "RED_ALERT_ESCALATION",
        "SYSTEM_STARTUP",
        "SYSTEM_SHUTDOWN",
      ],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    details: {
      error: String,
      stack: String,
      userId: mongoose.Schema.Types.ObjectId,
      pregnancyId: mongoose.Schema.Types.ObjectId,
      requestId: String,
      additionalData: mongoose.Schema.Types.Mixed,
    },
    resolved: {
      type: Boolean,
      default: false,
    },
    resolvedAt: Date,
    resolvedBy: String,
    notificationSent: {
      slack: Boolean,
      email: Boolean,
      sms: Boolean,
    },
  },
  {
    timestamps: true,
  },
);

// Index for querying unresolved critical issues
systemEventSchema.index({ severity: 1, resolved: 1, createdAt: -1 });

// TTL index to auto-delete old events after 90 days
systemEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 });

export default mongoose.model("SystemEvent", systemEventSchema);
