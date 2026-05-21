import mongoose from "mongoose";

const chewProfileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    phcId: {
      type: String,
      required: true,
      index: true,
    },
    phcName: String,
    phcAddress: String,
    lga: {
      type: String,
      required: true,
    },
    state: {
      type: String,
      required: true,
    },
    supervisorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    supervisorName: String,
    supervisorPhone: String,
    registrationCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    assignedWomenCount: {
      type: Number,
      default: 0,
    },
    performance: {
      ancCompletionRate: {
        type: Number,
        default: 0,
      },
      redFlagResponseRate: {
        type: Number,
        default: 0,
      },
      averageResponseTime: Number, // in minutes
      lastMonthMetrics: {
        ancVisitsConducted: Number,
        redFlagsResponded: Number,
        womenRegistered: Number,
      },
    },
    settings: {
      smsAlerts: {
        type: Boolean,
        default: true,
      },
      dailyDigest: {
        type: Boolean,
        default: true,
      },
      language: {
        type: String,
        enum: ["en", "pidgin", "yo", "ha", "ig"],
        default: "en",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLoginAt: Date,
    deviceInfo: {
      lastDevice: String,
      lastIP: String,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
chewProfileSchema.index({ phcId: 1, isActive: 1 });
chewProfileSchema.index({ lga: 1, state: 1 });

// Method to increment assigned count
chewProfileSchema.methods.incrementAssignedCount = async function () {
  this.assignedWomenCount += 1;
  await this.save();
};

export default mongoose.model("CHEWProfile", chewProfileSchema);
