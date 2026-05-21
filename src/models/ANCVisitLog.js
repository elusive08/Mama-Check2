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
      required: true,
    },
    chewId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "CHEWProfile",
      required: true,
    },
    visitWeek: {
      type: Number,
      required: true,
    },
    action: {
      type: String,
      enum: ["marked_attended", "undone", "unmarked"],
      required: true,
    },
    markedAtDate: {
      type: Date, // The actual date the woman attended (or claimed to have attended)
      required: true,
    },
    markedAtTime: Date, // When the CHEW marked it in the system
    notes: String,
    undoReason: String,
    undoTime: Date, // When it was undone
    canUndo: {
      type: Boolean,
      default: function () {
        if (this.action !== "marked_attended") return false;
        // Can undo if marked less than 10 minutes ago
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
        return this.markedAtTime > tenMinutesAgo;
      },
    },
  },
  { timestamps: true },
);

ancVisitLogSchema.index({ pregnancyId: 1, visitWeek: 1 });
ancVisitLogSchema.index({ markedAtTime: 1 }); // For undo window queries
ancVisitLogSchema.index({ action: 1 });

export default mongoose.model("ANCVisitLog", ancVisitLogSchema);
