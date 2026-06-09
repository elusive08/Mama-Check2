import mongoose from "mongoose";

/**
 * ANC Visit Attendance Log
 * Tracks all visit attendance changes with timestamps for undo functionality
 */
const ancVisitLogSchema = new mongoose.Schema(
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
      required: false,
    },
    chewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CHEWProfile",
      required: true,
    },
    visitWeek: {
      type: Number,
      required: true,
      min: 1,
      max: 8,
    },
    action: {
      type: String,
      enum: ["marked_attended", "undone", "unmarked"],
      required: true,
    },
    attendedDate: {
      type: Date,
      description:
        "The actual date the woman attended (or claimed to have attended)",
    },
    markedAtTime: {
      type: Date,
      default: Date.now,
      required: true,
    },
    notes: {
      type: String,
      maxlength: 500,
    },
    undoReason: {
      type: String,
      maxlength: 500,
    },
    undoTime: {
      type: Date,
    },
  },
  { timestamps: true },
);

// Auto-populate attendedDate for marked_attended records if not provided
ancVisitLogSchema.pre("save", function (next) {
  if (this.action === "marked_attended" && !this.attendedDate) {
    this.attendedDate = this.markedAtTime || new Date();
  }
  next();
});

// Virtual field for canUndo - calculated at query time
ancVisitLogSchema.virtual("canUndo").get(function () {
  if (this.action !== "marked_attended") return false;
  if (!this.markedAtTime) return false;

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  return this.markedAtTime > tenMinutesAgo;
});

// Virtual field for undo window expiration
ancVisitLogSchema.virtual("undoWindowExpires").get(function () {
  if (this.action !== "marked_attended") return null;
  if (!this.markedAtTime) return null;

  return new Date(this.markedAtTime.getTime() + 10 * 60 * 1000);
});

// Ensure virtuals are included in JSON output
ancVisitLogSchema.set("toJSON", { virtuals: true });
ancVisitLogSchema.set("toObject", { virtuals: true });

// Indexes for performance
ancVisitLogSchema.index({ pregnancyId: 1, visitWeek: 1 });
ancVisitLogSchema.index({ markedAtTime: -1 }); // For undo window queries
ancVisitLogSchema.index({ action: 1, markedAtTime: -1 });
ancVisitLogSchema.index({ pregnancyId: 1, markedAtTime: -1 });

export default mongoose.model("ANCVisitLog", ancVisitLogSchema);
