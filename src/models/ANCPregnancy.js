import mongoose from "mongoose";

const ancPregnancySchema = new mongoose.Schema(
  {
    pregnancyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pregnancy",
      required: true,
      unique: true,
    },
    currentMilestone: {
      type: Number,
      default: 0,
    },
    fmohSchedule: [
      {
        weekNumber: Number,
        milestoneNumber: Number,
        description: String,
        reminderSent: {
          type: Boolean,
          default: false,
        },
        reminderDate: Date,
        followupSent: {
          type: Boolean,
          default: false,
        },
        attended: {
          type: Boolean,
          default: false,
        },
      },
    ],
    missedVisits: [
      {
        weekNumber: Number,
        missedDate: Date,
        chewNotified: {
          type: Boolean,
          default: false,
        },
      },
    ],
    redFlagHistory: [
      {
        timestamp: Date,
        symptoms: [Number],
        triageOutcome: String,
        chewAlerted: Boolean,
        trustedAlerted: Boolean,
        followupOutcome: {
          type: String,
          enum: [
            "phone_contact",
            "clinic_visit",
            "referral_hospital",
            "unable_to_reach",
            "pending",
          ],
        },
      },
    ],
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("ANCPregnancy", ancPregnancySchema);
