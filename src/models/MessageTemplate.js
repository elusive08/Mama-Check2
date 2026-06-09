import mongoose from "mongoose";

const messageTemplateSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: [
        "welcome",
        "anc_reminder",
        "trusted_reminder",
        "weekly_checkin",
        "triage_green",
        "triage_yellow",
        "triage_red",
        "missed_visit",
        "followup_reminder",
        "alert_chew",
        "alert_trusted",
        "opt_out_confirmation",
      ],
      required: true,
    },
    language: {
      type: String,
      enum: ["en", "pidgin", "yo", "ha", "ig"],
      required: true,
    },
    content: {
      type: String,
      required: true,
      maxlength: 480, // 3 SMS segments
    },
    variables: [
      {
        name: String,
        description: String,
        required: Boolean,
      },
    ],
    milestoneNumber: {
      type: Number,
      min: 1,
      max: 8,
      required: function () {
        return this.type == "anc_reminder";
      },
    },
    version: {
      type: Number,
      default: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    metadata: {
      characterCount: Number,
      segmentCount: Number,
      lastTested: Date,
    },
  },
  {
    timestamps: true,
  },
);

// Compound index for quick lookup
messageTemplateSchema.index({
  type: 1,
  language: 1,
  milestoneNumber: 1,
  isActive: 1,
});

// Pre-save middleware to calculate segments
messageTemplateSchema.pre("save", function (next) {
  this.metadata = this.metadata || {};
  this.metadata.characterCount = this.content.length;
  // SMS segments: 160 chars for first segment, 153 for subsequent
  this.metadata.segmentCount =
    this.content.length <= 160
      ? 1
      : Math.ceil((this.content.length - 160) / 153) + 1;
  next();
});

export default mongoose.model("MessageTemplate", messageTemplateSchema);
