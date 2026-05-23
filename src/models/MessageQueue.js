import mongoose from "mongoose";

const messageQueueSchema = new mongoose.Schema(
  {
    to: {
      type: String,
      required: true,
    },
    from: {
      type: String,
      default: "MamaCheck",
    },
    templateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MessageTemplate",
    },
    content: String,
    language: {
      type: String,
      enum: ["en", "pidgin", "yo", "ha", "ig"],
      required: true,
    },
    type: {
      type: String,
      enum: [
        "reminder",
        "checkin",
        "triage_response",
        "alert",
        "welcome",
        "followup",
      ],
      required: true,
    },
    priority: {
      type: String,
      enum: ["high", "normal", "low"],
      default: "normal",
    },
    status: {
      type: String,
      enum: ["queued", "sending", "delivered", "failed", "cancelled"],
      default: "queued",
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    maxRetries: {
      type: Number,
      default: 3,
    },
    scheduledFor: {
      type: Date,
      default: Date.now,
    },
    sentAt: Date,
    deliveredAt: Date,
    error: String,
    metadata: {
      pregnancyId: mongoose.Schema.Types.ObjectId,
      womanId: mongoose.Schema.Types.ObjectId,
      triggerEvent: String,
      externalMessageId: String,
    },
  },
  {
    timestamps: true,
  },
);

// Index for scheduler
messageQueueSchema.index({ scheduledFor: 1, status: 1, priority: 1 });

export default mongoose.model("MessageQueue", messageQueueSchema);
