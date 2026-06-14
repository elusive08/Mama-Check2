import jwt from "jsonwebtoken";
import User from "../models/User.js";
import CHEWProfile from "../models/CHEWProfile.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  generalLimiter,
  registrationLimiter,
} from "../middleware/rateLimiter.js";
import express from "express";
import { comparePassword, hashPassword } from "../utils/passwordUtils.js";
import messagingService from "../services/messagingService.js";
import config from "../config/index.js";
import emailService from "../services/emailService.js";
import logger from "../utils/logger.js";
import otpStore from "../utils/otpStore.js";
import crypto from "node:crypto";
import mongoose from "mongoose";

const router = express.Router();

// Helpers
// Must match authController.generateTokens exactly:
//   - same secret (process.env.JWT_SECRET)
//   - same payload shape ({ userId, role, phone })
// so tokens from this router pass authMiddleware verification.
const signToken = (user) =>
  jwt.sign(
    { userId: user._id, role: user.role, phone: user.phone },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
  );

const PHONE_REGEX = /^(\+?234|0)[789]\d{9}$/;
const EMAIL_REGEX = /^\S+@\S+\.\S+$/;

// Middleware to check if user is admin (for protected admin routes)
const requireAdmin = async (req, res, next) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (user?.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    req.user = user;
    next();
  } catch (error) {
    logger.error("Admin auth error:", error.message);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

// Helper functions for forgot-password
async function findUserByIdentifier(email, phone) {
  const query = {};
  if (email) query.email = email.toLowerCase();
  if (phone) query.phone = phone;

  console.log(`[PASSWORD RESET] Searching for user with:`, query);

  const user = await User.findOne(query);

  if (user) {
    console.log(`[PASSWORD RESET] User found: ${user._id}`);
    console.log(`[PASSWORD RESET] - Email: ${user.email || "not set"}`);
    console.log(`[PASSWORD RESET] - Phone: ${user.phone}`);
    console.log(`[PASSWORD RESET] - Role: ${user.role}`);
  } else {
    console.log(`[PASSWORD RESET] No user found with query:`, query);
  }

  return user;
}

async function generateAndSaveResetToken(user) {
  const rawResetToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto
    .createHash("sha256")
    .update(rawResetToken)
    .digest("hex");

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
  await user.save();

  return rawResetToken;
}

async function sendResetNotifications(user, resetToken) {
  let emailSent = false;
  let smsSent = false;

  // Send email if available
  if (user.email) {
    const emailResult = await emailService.sendPasswordResetEmail(
      user.email,
      resetToken,
      user.firstName || user.name,
    );
    emailSent = emailResult.success;
    if (emailResult.success) {
      logger.info(`Password reset email sent to ${user.email}`);
    } else {
      logger.error(
        `Failed to send password reset email to ${user.email}: ${emailResult.error}`,
      );
    }
  }

  // Send SMS if phone exists and email failed or not available
  if (user.phone && (!user.email || !emailSent)) {
    const smsResult = await messagingService.sendSMS({
      to: user.phone,
      content: `Your password reset token is: ${resetToken}. Valid for 15 minutes. Do not share this code.`,
      type: "password_reset",
    });
    smsSent = smsResult.success;
    if (smsResult.success) {
      logger.info(`Password reset SMS sent to ${user.phone}`);
    } else {
      logger.error(
        `Failed to send password reset SMS to ${user.phone}: ${smsResult.error}`,
      );
    }
  }

  return { emailSent, smsSent };
}

function sendResetResponse(res, data) {
  return res.status(200).json(data);
}

// Helper function for alphanumeric OTP generation (cryptographically secure)
const generateAlphanumericOTP = (length = 6) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let otp = "";
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    const index = randomBytes[i] % chars.length;
    otp += chars[index];
  }
  return otp;
};

// CHEW REGISTRATION (Admin only - creates User + CHEWProfile)
/**
 * @swagger
 * /api/v1/auth/register-chew:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Register a new CHEW (Admin only)
 *     description: Creates a CHEW user account and CHEWProfile in one atomic transaction.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - phone
 *               - firstName
 *               - lastName
 *               - password
 *               - phcName
 *               - lga
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "chew@example.com"
 *               phone:
 *                 type: string
 *                 example: "08012345678"
 *               firstName:
 *                 type: string
 *                 example: "John"
 *               lastName:
 *                 type: string
 *                 example: "Smith"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: "SecurePass123"
 *               phcName:
 *                 type: string
 *                 example: "Central PHC Ikeja"
 *               lga:
 *                 type: string
 *                 example: "Ikeja"
 *               state:
 *                 type: string
 *                 example: "Lagos"
 *     responses:
 *       201:
 *         description: CHEW registered successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email or phone already registered
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.post(
  "/register-chew",
  registrationLimiter,
  requireAdmin,
  async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const {
        email,
        phone,
        firstName,
        lastName,
        password,
        phcName,
        lga,
        state,
      } = req.body;

      // Validation
      if (
        !email ||
        !phone ||
        !firstName ||
        !lastName ||
        !password ||
        !phcName ||
        !lga
      ) {
        return res.status(400).json({
          error:
            "Email, phone, firstName, lastName, password, phcName, and lga are required",
        });
      }

      if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      if (!PHONE_REGEX.test(phone)) {
        return res
          .status(400)
          .json({ error: "Invalid Nigerian phone number format" });
      }

      if (password.length < 8) {
        return res
          .status(400)
          .json({ error: "Password must be at least 8 characters" });
      }

      // Check existing by email OR phone
      const existingUser = await User.findOne({
        $or: [{ email: email.toLowerCase() }, { phone }],
      });

      if (existingUser) {
        if (existingUser.email === email.toLowerCase()) {
          return res.status(409).json({ error: "Email already registered" });
        }
        return res
          .status(409)
          .json({ error: "Phone number already registered" });
      }

      // Generate PHC ID
      const phcId = `PHC-${lga.toUpperCase().replace(/\s+/g, "-")}-${Date.now()}`;
      const hashedPassword = await hashPassword(password);
      const fullName = `${firstName.trim()} ${lastName.trim()}`;

      // Create User
      const newChew = await User.create(
        [
          {
            email: email.toLowerCase(),
            phone,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            name: fullName,
            state,
            lga,
            password: hashedPassword,
            role: "chew",
            phoneVerified: true,
            consent: {
              sms: true,
              dataProcessing: true,
              consentDate: new Date(),
            },
            optOut: { isOptedOut: false },
          },
        ],
        { session },
      );

      // Create CHEWProfile
      await CHEWProfile.create(
        [
          {
            userId: newChew[0]._id,
            phcId,
            phcName,
            lga,
            state: state || "Unknown",
            phone,
            isActive: true,
          },
        ],
        { session },
      );

      await session.commitTransaction();

      const token = signToken(newChew[0]);

      res.status(201).json({
        success: true,
        message: "CHEW registered successfully",
        token,
        user: {
          id: newChew[0]._id,
          firstName: newChew[0].firstName,
          lastName: newChew[0].lastName,
          name: newChew[0].name,
          email: newChew[0].email,
          phone: newChew[0].phone,
          role: newChew[0].role,
          phcId,
          state: newChew[0].state,
          lga: newChew[0].lga,
        },
      });
    } catch (error) {
      await session.abortTransaction();
      console.error("Register CHEW error:", error);
      res.status(500).json({ error: "CHEW registration failed" });
    } finally {
      session.endSession();
    }
  },
);

/**
 * @swagger
 * /api/v1/auth/request-otp:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Send verification code to verify phone
 *     description: Sends a 6-digit alphanumeric verification code to the registered phone number.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "08012345678"
 *     responses:
 *       200:
 *         description: Verification code sent successfully
 *       400:
 *         description: Invalid phone number or account not found
 *       429:
 *         description: Too many requests - wait 60 seconds
 */
router.post("/request-otp", registrationLimiter, async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ error: "Phone number is required" });
    }

    if (!PHONE_REGEX.test(phone)) {
      return res
        .status(400)
        .json({ error: "Invalid Nigerian phone number format" });
    }

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(400).json({
        error:
          "No account found for this number. Please contact your CHEW to register.",
      });
    }

    if (user.phoneVerified) {
      return res.status(423).json({ error: "Phone number already verified" });
    }

    // Generate alphanumeric OTP (e.g., "4r7t8w")
    const otp = generateAlphanumericOTP(6);
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

    await User.findByIdAndUpdate(user._id, { otp, otpExpiry });

    try {
      await otpStore.set(phone, { otp, attempts: 0, verified: false }, 300);
    } catch (redisErr) {
      console.warn(`Redis OTP storage failed: ${redisErr.message}`);
    }

    const result = await messagingService.sendSMS({
      to: phone,
      content: `Your MamaCheck verification code is: ${otp}. Valid for 5 minutes. Do not share this code.`,
      type: "otp",
    });

    if (!result.success) {
      await User.findByIdAndUpdate(user._id, { otp: null, otpExpiry: null });
      return res
        .status(500)
        .json({ error: "Failed to send verification code. Please try again." });
    }

    res.json({
      success: true,
      message: "Verification code sent successfully",
      expiresIn: 300,
    });
  } catch (error) {
    console.error("Request OTP error:", error);
    res.status(500).json({ error: "Failed to send verification code" });
  }
});

/**
 * @swagger
 * /api/v1/auth/verify-otp:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Verify OTP and activate account
 *     description: Verifies the 6-digit alphanumeric verification code and marks the phone as verified.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *               - otp
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "08012345678"
 *               otp:
 *                 type: string
 *                 example: "4r7t8w"
 *     responses:
 *       200:
 *         description: Phone verified successfully
 *       400:
 *         description: Invalid or expired verification code
 *       404:
 *         description: Phone number not found
 */
router.post("/verify-otp", registrationLimiter, async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res
        .status(400)
        .json({ error: "Phone and verification code are required" });
    }

    // Test environment bypass
    const isTestEnv = process.env.NODE_ENV === "test";
    const bypassOtp =
      process.env.BYPASS_OTP_FOR_TESTING === "true" && isTestEnv;

    if (bypassOtp && otp.toString().length >= 4) {
      logger.info(`Test mode: OTP bypass for ${phone}`);

      let user = await User.findOne({ phone });
      if (!user) {
        user = new User({
          phone,
          role: "patient",
          phoneVerified: true,
          phoneVerifiedAt: new Date(),
          optOut: { isOptedOut: false },
        });
        await user.save();
      } else if (!user.phoneVerified) {
        user.phoneVerified = true;
        user.phoneVerifiedAt = new Date();
        await user.save();
      }

      const token = signToken(user);
      return res.status(200).json({
        success: true,
        token,
        message: "Verification successful (test mode)",
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          name: user.name,
          phone: user.phone,
          role: user.role,
          phoneVerified: true,
        },
      });
    }

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ error: "Phone number not found" });
    }

    if (user.phoneVerified) {
      return res.status(423).json({ error: "Phone already verified" });
    }

    // Check if OTP exists
    if (!user.otp) {
      return res.status(400).json({
        error: "No verification code found. Please request a new one.",
      });
    }

    // Check expiration
    if (new Date() > user.otpExpiry) {
      // Clear expired OTP
      await User.findByIdAndUpdate(user._id, {
        otp: null,
        otpExpiry: null,
      });
      await otpStore.delete(phone);

      return res.status(400).json({
        error: "Verification code expired. Please request a new one.",
      });
    }

    // Track failed attempts from Redis
    let storedOTP = await otpStore.get(phone);
    if (!storedOTP) {
      // Initialize attempt tracking if not exists
      storedOTP = { otp: user.otp, attempts: 0, verified: false };
      await otpStore.set(phone, storedOTP, 300);
    }

    // Check max attempts
    if (storedOTP.attempts >= 3) {
      await User.findByIdAndUpdate(user._id, {
        otp: null,
        otpExpiry: null,
      });
      await otpStore.delete(phone);

      return res.status(400).json({
        error:
          "Too many failed attempts. Please request a new verification code.",
      });
    }

    // Case-insensitive comparison for alphanumeric OTP
    if (!user.otp || user.otp.toLowerCase() !== otp.toLowerCase()) {
      // Increment failed attempts
      storedOTP.attempts = (storedOTP.attempts || 0) + 1;
      await otpStore.set(phone, storedOTP, 300);

      const remainingAttempts = 3 - storedOTP.attempts;
      return res.status(400).json({
        error: `Invalid verification code. ${remainingAttempts} attempt(s) remaining.`,
      });
    }

    // Success - clear OTP and mark verified
    await User.findByIdAndUpdate(user._id, {
      otp: null,
      otpExpiry: null,
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
    });

    // Clear OTP from Redis
    await otpStore.delete(phone);

    const token = signToken(user);

    res.json({
      success: true,
      message: "Phone verified successfully.",
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        phone: user.phone,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        phoneVerified: true,
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ADMIN REGISTRATION (Super-admin only - protected)

/**
 * @swagger
 * /api/v1/auth/register-admin:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Register a new Admin (Admin only)
 *     description: Creates a new admin account. Only existing admins can create new admins.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - phone
 *               - firstName
 *               - lastName
 *               - state
 *               - lga
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "admin@example.com"
 *               phone:
 *                 type: string
 *                 example: "08012345678"
 *               firstName:
 *                 type: string
 *                 example: "Admin"
 *               lastName:
 *                 type: string
 *                 example: "User"
 *               state:
 *                 type: string
 *                 example: "Lagos"
 *               lga:
 *                 type: string
 *                 example: "Ikeja"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: "SecurePass123"
 *     responses:
 *       201:
 *         description: Admin registered successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email or phone already registered
 *       401:
 *         description: Authentication required
 *       403:
 *         description: Admin access required
 */
router.post(
  "/register-admin",
  registrationLimiter,
  requireAdmin,
  async (req, res) => {
    try {
      const { email, phone, firstName, lastName, state, lga, password } =
        req.body;

      // Validation
      if (
        !email ||
        !phone ||
        !firstName ||
        !lastName ||
        !state ||
        !lga ||
        !password
      ) {
        return res.status(400).json({
          error:
            "All fields required: email, phone, firstName, lastName, state, lga, password",
        });
      }

      if (!EMAIL_REGEX.test(email)) {
        return res.status(400).json({ error: "Invalid email format" });
      }

      if (!PHONE_REGEX.test(phone)) {
        return res
          .status(400)
          .json({ error: "Invalid Nigerian phone number format" });
      }

      if (password.length < 8) {
        return res
          .status(400)
          .json({ error: "Password must be at least 8 characters" });
      }

      // Check existing by email OR phone
      const existingUser = await User.findOne({
        $or: [{ email: email.toLowerCase() }, { phone }],
      });

      if (existingUser) {
        if (existingUser.email === email.toLowerCase()) {
          return res.status(409).json({ error: "Email already registered" });
        }
        return res
          .status(409)
          .json({ error: "Phone number already registered" });
      }

      const hashedPassword = await hashPassword(password);
      const fullName = `${firstName.trim()} ${lastName.trim()}`;

      const newAdmin = await User.create({
        email: email.toLowerCase(),
        phone,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        name: fullName,
        state,
        lga,
        password: hashedPassword,
        role: "admin",
        phoneVerified: true,
        consent: { sms: true, dataProcessing: true, consentDate: new Date() },
        optOut: { isOptedOut: false },
      });

      const token = signToken(newAdmin);

      res.status(201).json({
        success: true,
        message: "Admin registered successfully",
        token,
        user: {
          id: newAdmin._id,
          firstName: newAdmin.firstName,
          lastName: newAdmin.lastName,
          name: newAdmin.name,
          email: newAdmin.email,
          phone: newAdmin.phone,
          role: newAdmin.role,
          state: newAdmin.state,
          lga: newAdmin.lga,
        },
      });
    } catch (error) {
      console.error("Register admin error:", error);
      res.status(500).json({ error: "Admin registration failed" });
    }
  },
);

// SEED SUPER ADMIN (Run once via CLI or special endpoint)

/**
 * @swagger
 * /api/v1/auth/seed-super-admin:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Seed the first super admin (Development only)
 *     description: Creates the first admin account. Only works in development or with ALLOW_SEEDING=true.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - phone
 *               - firstName
 *               - lastName
 *               - state
 *               - lga
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "superadmin@mamacheck.com"
 *               phone:
 *                 type: string
 *                 example: "08012345678"
 *               firstName:
 *                 type: string
 *                 example: "Super"
 *               lastName:
 *                 type: string
 *                 example: "Admin"
 *               state:
 *                 type: string
 *                 example: "Lagos"
 *               lga:
 *                 type: string
 *                 example: "Ikeja"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: "SuperSecure123"
 *     responses:
 *       201:
 *         description: Super Admin created successfully
 *       400:
 *         description: Admin already exists or validation error
 *       403:
 *         description: Seeding disabled in production
 */

router.post("/seed-super-admin", async (req, res) => {
  // Only allow in development or via specific seed token
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_SEEDING) {
    return res.status(403).json({ error: "Seeding disabled in production" });
  }

  try {
    const existingAdmin = await User.findOne({ role: "admin" });
    if (existingAdmin) {
      return res
        .status(400)
        .json({ error: "Admin already exists. Use /register-admin instead." });
    }

    const { email, phone, firstName, lastName, state, lga, password } =
      req.body;

    if (
      !email ||
      !phone ||
      !firstName ||
      !lastName ||
      !state ||
      !lga ||
      !password
    ) {
      return res.status(400).json({ error: "All fields required" });
    }

    const hashedPassword = await hashPassword(password);
    const fullName = `${firstName.trim()} ${lastName.trim()}`;

    const superAdmin = await User.create({
      email: email.toLowerCase(),
      phone,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      name: fullName,
      state,
      lga,
      password: hashedPassword,
      role: "admin",
      phoneVerified: true,
    });

    const token = signToken(superAdmin);

    res.status(201).json({
      success: true,
      message: "Super Admin created successfully",
      token,
      user: {
        id: superAdmin._id,
        email: superAdmin.email,
        phone: superAdmin.phone,
        role: superAdmin.role,
      },
    });
  } catch (error) {
    console.error("Seed super admin error:", error);
    res.status(500).json({ error: "Failed to seed super admin" });
  }
});

// LOGIN (Supports Email OR Phone)

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Login with email/phone and password
 *     description: Authenticates a user and returns a JWT token. Works for all roles (patient, chew, admin).
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "user@example.com"
 *               phone:
 *                 type: string
 *                 example: "08012345678"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "SecurePass123"
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     firstName:
 *                       type: string
 *                     lastName:
 *                       type: string
 *                     name:
 *                       type: string
 *                     email:
 *                       type: string
 *                     phone:
 *                       type: string
 *                     role:
 *                       type: string
 *                     phoneVerified:
 *                       type: boolean
 *       400:
 *         description: Missing email/phone or password
 *       401:
 *         description: Invalid credentials or unverified account
 */
router.post("/login", generalLimiter, async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    if ((!email && !phone) || !password) {
      return res
        .status(400)
        .json({ error: "Email/Phone and password are required" });
    }

    // Build query for email OR phone
    const identifier = email || phone;
    const user = await User.findOne({
      $or: [{ email: identifier.toLowerCase() }, { phone: identifier }],
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.optOut?.isOptedOut) {
      return res.status(401).json({ error: "Account has been deactivated" });
    }

    // Only patients need phone verification
    if (user.role === "patient" && !user.phoneVerified) {
      return res.status(401).json({
        error:
          "Phone number not verified. Please complete verification via /request-otp.",
      });
    }

    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    user.lastLoginAt = new Date();
    user.lastLoginIP = req.ip;
    await user.save();

    const token = signToken(user);

    let chewProfile = null;
    if (user.role === "chew" || user.role === "supervisor") {
      chewProfile = await CHEWProfile.findOne({ userId: user._id });
    }

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        phoneVerified: user.phoneVerified,
        state: user.state,
        lga: user.lga,
        residentialAddress: user.residentialAddress,
        trustedContact: user.trustedContact,
        chewProfile: chewProfile
          ? {
              phcId: chewProfile.phcId,
              phcName: chewProfile.phcName,
              lga: chewProfile.lga,
              state: chewProfile.state,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
});

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     tags:
 *       - Auth
 *     summary: Get current user profile
 *     description: Returns the authenticated user's profile information.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User profile retrieved successfully
 *       401:
 *         description: Unauthorized - Invalid or missing token
 */
router.get("/me", authMiddleware, async (req, res) => {
  const user = req.user.toObject();
  delete user.password;
  delete user.otp;
  delete user.otpExpiry;
  delete user.resetPasswordToken;
  delete user.resetPasswordExpires;
  res.json(user);
});

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Logout user
 *     description: Revokes the current JWT token.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       500:
 *         description: Logout failed
 */
router.post("/logout", authMiddleware, async (req, res) => {
  try {
    const token = req.token;
    if (token) {
      const decoded = jwt.decode(token);
      if (decoded?.exp) {
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          const redis = (await import("../config/redis.js")).default;
          await redis.setex(`revoked:${token}`, ttl, "1");
        }
      }
    }
    res.json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Logout failed" });
  }
});

/**
 * @swagger
 * /api/v1/auth/refresh-token:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Refresh access token
 *     description: Get a new access token using a refresh token.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 example: "eyJhbGciOiJIUzI1NiIs..."
 *     responses:
 *       200:
 *         description: New access token generated
 *       400:
 *         description: Refresh token required
 *       401:
 *         description: Invalid or expired refresh token
 */
router.post("/refresh-token", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token required" });
    }

    const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
    if (decoded.type !== "refresh") {
      return res.status(401).json({ error: "Invalid token type" });
    }

    const user = await User.findOne({
      _id: decoded.userId,
      "optOut.isOptedOut": { $ne: true },
    });

    if (!user) {
      return res.status(401).json({ error: "User not found or deactivated" });
    }

    const { accessToken, refreshToken: newRefreshToken } = (
      await import("../middleware/auth.js")
    ).generateTokens(user);

    res.json({
      success: true,
      accessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    console.error("Refresh token error:", error);
    res.status(401).json({ error: "Invalid or expired refresh token" });
  }
});

/**
 * @swagger
 * /api/v1/auth/change-password:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Change password
 *     description: Changes the authenticated user's password.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 format: password
 *                 example: "OldPass123"
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: "NewPass456"
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Missing current or new password
 *       401:
 *         description: Current password is incorrect
 */
router.post("/change-password", authMiddleware, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = req.user;

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ error: "Current and new password required" });
    }

    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "New password must be at least 6 characters" });
    }

    const isValid = await comparePassword(currentPassword, user.password);
    if (!isValid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    user.password = await hashPassword(newPassword);
    user.passwordChangedAt = new Date();
    await user.save();

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ error: "Failed to change password" });
  }
});

/**
 * @swagger
 * /api/v1/auth/forgot-password:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Request password reset
 *     description: Sends a password reset token to the user's email or phone.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "user@example.com"
 *               phone:
 *                 type: string
 *                 example: "08012345678"
 *     responses:
 *       200:
 *         description: Reset instructions sent (if account exists)
 *       400:
 *         description: Email or phone number required
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email, phone } = req.body;

    if (!email && !phone) {
      return res.status(400).json({ error: "Email or phone number required" });
    }

    const user = await findUserByIdentifier(email, phone);
    if (!user) {
      return sendResetResponse(res, {
        success: true,
        message: "If an account exists, you will receive reset instructions",
      });
    }

    const resetToken = await generateAndSaveResetToken(user);
    const { emailSent, smsSent } = await sendResetNotifications(
      user,
      resetToken,
    );

    if (process.env.NODE_ENV !== "production") {
      return sendResetResponse(res, {
        success: true,
        message: "Reset instructions sent",
        resetToken,
        emailSent,
        smsSent,
        expiresIn: 900,
      });
    }

    sendResetResponse(res, {
      success: true,
      message: "If an account exists, you will receive reset instructions",
    });
  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ error: "Failed to process request" });
  }
});

/**
 * @swagger
 * /api/v1/auth/reset-password:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Reset password with token
 *     description: Resets the user's password using a valid reset token.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *                 example: "abc123def456..."
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 minLength: 6
 *                 example: "NewSecurePass123"
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid or expired token, or validation error
 */
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password required" });
    }

    if (newPassword.length < 6) {
      return res
        .status(400)
        .json({ error: "Password must be at least 6 characters" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ error: "Invalid or expired reset token" });
    }

    user.password = await hashPassword(newPassword);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.passwordChangedAt = new Date();
    await user.save();

    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
});

export default router;
