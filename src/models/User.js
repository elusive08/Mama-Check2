import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    // ========== PERSONAL INFO ==========
    name: {
      type: String,
      required: true,
      trim: true,
    },
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
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
      index: true,
    },

    // ========== ADDRESS (Original nested - KEPT for backward compatibility) ==========
    address: {
      street: String,
      lga: String,
      state: String,
      landmark: String,
    },

    // ========== ADDRESS (New top-level - ADDED for new code) ==========
    residentialAddress: {
      type: String,
      trim: true,
    },
    street: {
      type: String,
      trim: true,
    },
    lga: {
      type: String,
      trim: true,
    },
    state: {
      type: String,
      trim: true,
    },
    landmark: {
      type: String,
      trim: true,
    },

    // ========== PREFERENCES ==========
    preferredLanguage: {
      type: String,
      enum: ["en", "pidgin", "yo", "ha", "ig"],
      default: "en",
    },

    // ========== AUTHENTICATION ==========
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
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    passwordChangedAt: Date,
    lastLoginAt: Date,
    lastLoginIP: String,

    // ========== ROLE ==========
    role: {
      type: String,
      enum: ["patient", "chew", "supervisor", "admin"],
      default: "patient",
    },

    // ========== TRUSTED CONTACT ==========
    trustedContact: {
      name: String,
      phone: String,
      relationship: String,
      preferredLanguage: {
        type: String,
        enum: ["en", "pidgin", "yo", "ha", "ig"],
      },
    },

    // ========== CONSENT ==========
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

    // ========== VERIFICATION ==========
    phoneVerified: {
      type: Boolean,
      default: false,
    },
    phoneVerifiedAt: {
      type: Date,
    },

    // ========== OPT OUT ==========
    optOut: {
      isOptedOut: {
        type: Boolean,
        default: false,
      },
      reason: String,
      date: Date,
    },

    // ========== METADATA ==========
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
userSchema.index({ email: 1 });
userSchema.index({ lga: 1, state: 1 });
userSchema.index({ "trustedContact.phone": 1 });

// Virtual to get full address (backward compatible)
userSchema.virtual("fullAddress").get(function () {
  if (this.residentialAddress) return this.residentialAddress;
  if (this.address?.street) {
    const parts = [
      this.address.street,
      this.address.lga,
      this.address.state,
    ].filter(Boolean);
    return parts.join(", ");
  }
  return null;
});

// Pre-save middleware to sync top-level fields with nested address (optional)
userSchema.pre("save", function (next) {
  // If top-level lga/state are set but nested isn't, sync to nested for backward compatibility
  if (this.lga && this.address && !this.address.lga) {
    this.address.lga = this.lga;
  }
  if (this.state && this.address && !this.address.state) {
    this.address.state = this.state;
  }
  if (this.street && this.address && !this.address.street) {
    this.address.street = this.street;
  }
  if (this.landmark && this.address && !this.address.landmark) {
    this.address.landmark = this.landmark;
  }
  next();
});

// Methods
userSchema.methods.getDisplayName = function () {
  return this.firstName || this.name?.split(" ")[0] || "User";
};

userSchema.methods.canReceiveSMS = function () {
  return this.consent.sms && !this.optOut.isOptedOut;
};

export default mongoose.model("User", userSchema);
