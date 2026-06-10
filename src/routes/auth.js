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
import otpStore from "../utils/otpStore.js";
import crypto from "node:crypto";

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const signToken = (user) =>
  jwt.sign({ userId: user._id, role: user.role }, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn,
  });

const PHONE_REGEX = /^(\+?234|0)[789]\d{9}$/;

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Step 1 — Create patient account
 *     description: >
 *       Registers a new patient with name, phone, and password.
 *       After this call, the account exists but phone is unverified.
 *       Call /request-otp next to send a verification code, then
 *       /verify-otp to activate the account.
 *       Role is always "patient" — use /register-chew for CHEW accounts.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *               - password
 *               - name
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+2348012345678"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: "SecurePassword123!"
 *               name:
 *                 type: string
 *                 example: "Amaka Obi"
 *               preferredLanguage:
 *                 type: string
 *                 enum: ["en", "pidgin", "yo", "ha", "ig"]
 *                 default: "en"
 *     responses:
 *       201:
 *         description: Account created — proceed to /request-otp to verify phone
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 token:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     name:
 *                       type: string
 *                     phone:
 *                       type: string
 *                     role:
 *                       type: string
 *                     phoneVerified:
 *                       type: boolean
 *       400:
 *         description: Validation error
 *       409:
 *         description: Phone number already registered
 *       500:
 *         description: Server error
 */
router.post("/register", registrationLimiter, async (req, res) => {
  try {
    const { phone, password, name, preferredLanguage = "en" } = req.body;

    if (!phone || !password || !name) {
      return res
        .status(400)
        .json({ error: "Phone, password, and name are required" });
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

    const VALID_LANGUAGES = ["en", "pidgin", "yo", "ha", "ig"];
    if (!VALID_LANGUAGES.includes(preferredLanguage)) {
      return res.status(400).json({
        error: `preferredLanguage must be one of: ${VALID_LANGUAGES.join(", ")}`,
      });
    }

    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res
        .status(409)
        .json({ error: "This phone number is already registered" });
    }

    const hashedPassword = await hashPassword(password);

    const newUser = await User.create({
      phone,
      password: hashedPassword,
      name: name.trim(),
      role: "patient",
      preferredLanguage,
      phoneVerified: false, // must verify via OTP after registration
    });

    const token = signToken(newUser);

    res.status(201).json({
      success: true,
      message:
        "Account created. Please verify your phone number — call /request-otp to receive your code.",
      token,
      user: {
        id: newUser._id,
        name: newUser.name,
        phone: newUser.phone,
        role: newUser.role,
        preferredLanguage: newUser.preferredLanguage,
        phoneVerified: false,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/v1/auth/request-otp:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Step 2 — Send OTP to verify phone
 *     description: >
 *       Sends a 6-digit OTP to a registered phone number.
 *       The user must already have an account (call /register first).
 *       OTP expires after 5 minutes. Rate-limited to one request per 60 seconds.
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
 *                 example: "+2348012345678"
 *     responses:
 *       200:
 *         description: OTP sent successfully
 *       400:
 *         description: Invalid phone format or account not found
 *       429:
 *         description: Rate limit — wait 60 seconds before retrying
 *       500:
 *         description: Server error
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

    // User must exist before we can send OTP
    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(400).json({
        error: "No account found for this number. Please register first.",
      });
    }

    if (user.phoneVerified) {
      return res
        .status(400)
        .json({ error: "This phone number is already verified" });
    }

    // Cryptographically secure 6-digit OTP
    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Save OTP to user record
    await User.findByIdAndUpdate(user._id, { otp, otpExpiry });

    // Best-effort Redis write for dedup/rate-limiting
    try {
      await otpStore.set(phone, { otp, attempts: 0, verified: false }, 300);
    } catch (redisErr) {
      console.warn(
        `Redis OTP storage failed for ${phone}: ${redisErr.message}`,
      );
    }

    const result = await messagingService.sendSMS({
      to: phone,
      content: `Your MamaCheck verification code is: ${otp}. Valid for 5 minutes. Do not share this code.`,
      type: "otp",
      save: () => Promise.resolve(),
      metadata: {},
      retryCount: 0,
      maxRetries: 3,
    });

    if (!result.success) {
      // Roll back OTP so user can try again
      await User.findByIdAndUpdate(user._id, { otp: null, otpExpiry: null });
      return res.status(500).json({
        error: "Failed to send OTP. Please try again.",
        twilioError:
          process.env.NODE_ENV === "production" ? undefined : result.error,
      });
    }

    res.json({
      success: true,
      message: "OTP sent successfully",
      expiresIn: 300,
    });
  } catch (error) {
    console.error("Request OTP error:", error);
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/v1/auth/verify-otp:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Step 3 — Verify OTP and activate account
 *     description: >
 *       Verifies the OTP sent to the user's phone and marks the account as active.
 *       After this step the account is fully verified and the user can log in.
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
 *                 example: "+2348012345678"
 *               otp:
 *                 type: string
 *                 description: 6-digit OTP code received via SMS
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: Phone verified — account is now active
 *       400:
 *         description: Invalid OTP, expired OTP, or missing fields
 *       404:
 *         description: Phone number not found
 *       500:
 *         description: Server error
 */
router.post("/verify-otp", registrationLimiter, async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: "Phone and OTP are required" });
    }

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(404).json({ error: "Phone number not found" });
    }

    if (user.phoneVerified) {
      return res
        .status(400)
        .json({ error: "This phone number is already verified" });
    }

    if (!user.otp || user.otp !== otp) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    if (new Date() > user.otpExpiry) {
      return res.status(400).json({
        error: "OTP has expired. Please request a new one via /request-otp.",
      });
    }

    // Mark account as verified and clear OTP
    await User.findByIdAndUpdate(user._id, {
      otp: null,
      otpExpiry: null,
      phoneVerified: true,
      phoneVerifiedAt: new Date(),
    });

    const token = signToken(user);

    res.json({
      success: true,
      message: "Phone verified successfully. Your account is now active.",
      token,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        phoneVerified: true,
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ error: "OTP verification failed" });
  }
});

// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Login
 *     description: >
 *       Authenticate with phone and password. Returns a JWT token.
 *       Account must be phone-verified before login is allowed.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *               - password
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+2348012345678"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "SecurePassword123!"
 *     responses:
 *       200:
 *         description: Login successful
 *       400:
 *         description: Missing fields
 *       401:
 *         description: Invalid credentials, unverified account, or deactivated account
 *       500:
 *         description: Server error
 */
router.post("/login", generalLimiter, async (req, res) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ error: "Phone and password are required" });
    }

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.optOut?.isOptedOut) {
      return res.status(401).json({ error: "Account has been deactivated" });
    }

    if (!user.phoneVerified) {
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
        name: user.name,
        phone: user.phone,
        role: user.role,
        preferredLanguage: user.preferredLanguage,
        phoneVerified: user.phoneVerified,
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

// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     tags:
 *       - Auth
 *     summary: Get current user profile
 *     description: Returns the authenticated user's profile. Sensitive fields excluded.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
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

// ---------------------------------------------------------------------------

/**
 * @swagger
 * /api/v1/auth/register-chew:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Register a new CHEW
 *     description: >
 *       Creates a CHEW account and PHC profile. The PHC ID is always
 *       system-generated in the format PHC-{LGA}-{timestamp} and returned
 *       in the response. Should only be called by an admin or supervisor.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *               - firstName
 *               - lastName
 *               - password
 *               - phcName
 *               - lga
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "+2348098765432"
 *               firstName:
 *                 type: string
 *                 example: "Chinedu"
 *               lastName:
 *                 type: string
 *                 example: "Okonkwo"
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 example: "SecurePassword123!"
 *               phcName:
 *                 type: string
 *                 example: "Central PHC Kosofe"
 *               lga:
 *                 type: string
 *                 example: "Kosofe"
 *               state:
 *                 type: string
 *                 example: "Lagos"
 *     responses:
 *       201:
 *         description: CHEW registered — phcId is in the response
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
 *                     name:
 *                       type: string
 *                     phone:
 *                       type: string
 *                     role:
 *                       type: string
 *                       enum: ["chew"]
 *                     phcId:
 *                       type: string
 *                       example: "PHC-KOSOFE-1780620246123"
 *       400:
 *         description: Validation error
 *       409:
 *         description: Phone number already registered
 *       500:
 *         description: Server error
 */
router.post("/register-chew", registrationLimiter, async (req, res) => {
  try {
    const { phone, firstName, lastName, password, phcName, lga, state } =
      req.body;

    if (!phone || !firstName || !lastName || !password || !phcName || !lga) {
      return res.status(400).json({
        error:
          "Phone, firstName, lastName, password, phcName, and lga are required",
      });
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

    // Check across ALL roles — phone must be globally unique
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res
        .status(409)
        .json({ error: "This phone number is already registered" });
    }

    // System-generated PHC ID — never accepted from caller
    const phcId = `PHC-${lga.toUpperCase().replace(/\s+/g, "-")}-${Date.now()}`;

    const hashedPassword = await hashPassword(password);

    const newChew = await User.create({
      phone,
      name: `${firstName.trim()} ${lastName.trim()}`,
      password: hashedPassword,
      role: "chew",
      phoneVerified: true, // CHEWs are admin-registered, no OTP needed
      consent: { sms: true, dataProcessing: true },
      optOut: { isOptedOut: false },
    });

    await CHEWProfile.create({
      userId: newChew._id,
      phcId,
      phcName,
      lga,
      state: state || "Unknown",
      phone,
      performanceMetrics: {
        totalWomenManaged: 0,
        totalVisitsCompleted: 0,
        visitCompletionRate: 0,
        averageResponseTime: 0,
        redFlagsIdentified: 0,
        referralsInitiated: 0,
      },
    });

    const token = signToken(newChew);

    res.status(201).json({
      success: true,
      message: "CHEW registered successfully",
      token,
      user: {
        id: newChew._id,
        name: newChew.name,
        phone: newChew.phone,
        role: newChew.role,
        phcId,
      },
    });
  } catch (error) {
    console.error("Register CHEW error:", error);
    res.status(500).json({ error: "CHEW registration failed" });
  }
});

export default router;
