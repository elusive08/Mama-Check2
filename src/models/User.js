import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      sparse: true,
      lowercase: true,
      trim: true,
    },
    address: {
      street: String,
      lga: String,
      state: String,
      landmark: String,
    },
    preferredLanguage: {
      type: String,
      enum: ["en", "pidgin", "yo", "ha", "ig"],
      default: "en",
    },
    password: {
      type: String,
      required: true,
    },
    otp: {
      type: String,
      default: null,
    },
    otpExpiry: {
      type: Date,
      default: null,
    },
    role: {
      type: String,
      enum: ["patient", "chew", "supervisor", "admin"],
      default: "patient",
    },
    trustedContact: {
      name: String,
      phone: String,
      relationship: String,
      preferredLanguage: {
        type: String,
        enum: ["en", "pidgin", "yo", "ha", "ig"],
      },
    },
    consent: {
      sms: {
        type: Boolean,
        default: false,
      },
      dataProcessing: {
        type: Boolean,
        default: false,
      },
      consentDate: Date,
      withdrawDate: Date,
    },
    phoneVerified: {
      type: Boolean,
      default: false,
    },
    phoneVerifiedAt: {
      type: Date,
    },
    optOut: {
      isOptedOut: {
        type: Boolean,
        default: false,
      },
      reason: String,
      date: Date,
    },
    metadata: {
      registrationSource: {
        type: String,
        enum: ["chew_dashboard", "ussd", "api", "bulk_upload"],
        default: "chew_dashboard",
      },
      registeredBy: mongoose.Schema.Types.ObjectId,
      deviceInfo: String,
      ipAddress: String,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
userSchema.index({ phone: 1, role: 1 });
userSchema.index({ "trustedContact.phone": 1 });

// Methods
userSchema.methods.getDisplayName = function () {
  return this.name.split(" ")[0]; // First name only for privacy
};

userSchema.methods.canReceiveSMS = function () {
  return this.consent.sms && !this.optOut.isOptedOut;
};

export default mongoose.model("User", userSchema);
