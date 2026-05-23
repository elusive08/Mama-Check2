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

const router = express.Router();

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     tags:
 *       - Auth
 *     summary: User login
 *     description: Authenticate user with phone number and password. Returns JWT token for subsequent requests.
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
 *         description: Login successful, returns JWT token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
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
 *                       enum: ["patient", "chew", "supervisor", "admin"]
 *       401:
 *         description: Invalid credentials
 *       500:
 *         description: Server error
 */
router.post("/login", generalLimiter, async (req, res) => {
  try {
    const { phone, password } = req.body;

    const user = await User.findOne({ phone });
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Use bcrypt for secure password comparison
    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn },
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     tags:
 *       - Auth
 *     summary: Get current user profile
 *     description: Returns the authenticated user's profile information
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Server error
 */
// Get current user
router.get("/me", authMiddleware, async (req, res) => {
  res.json(req.user);
});

/**
 * @swagger
 * /api/v1/auth/request-otp:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Request OTP for phone verification
 *     description: Send OTP code to user's phone number for registration or verification
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
 *         description: Bad request - invalid phone format
 *       429:
 *         description: Too many requests - rate limit exceeded
 *       500:
 *         description: Server error
 */
// Request OTP
router.post("/request-otp", registrationLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry

    // Store OTP in database (MVP implementation)
    await User.findOneAndUpdate(
      { phone },
      {
        otp,
        otpExpiry,
      },
      { upsert: false },
    );

    // Integrate with MessagingService to send OTP
    const result = await messagingService.sendSMS({
      to: phone,
      content: `Your OTP is: ${otp}`,
      type: "otp",
      save: () => Promise.resolve(),
      metadata: {},
      retryCount: 0,
      maxRetries: 3,
    });

    if (!result.success) {
      throw new Error("Failed to send OTP via SMS service");
    }

    res.json({ message: "OTP sent successfully" });
  } catch (error) {
    console.error("Request OTP error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/v1/auth/verify-otp:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Verify OTP code
 *     description: Verify the OTP sent to user's phone number. Returns JWT token on successful verification.
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
 *                 description: 6-digit OTP code sent to phone
 *                 example: "123456"
 *     responses:
 *       200:
 *         description: OTP verified successfully, returns JWT token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
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
 *                       enum: ["patient", "chew", "supervisor", "admin"]
 *       400:
 *         description: Invalid OTP, expired OTP, or user not found
 *       401:
 *         description: Unauthorized - invalid credentials
 *       429:
 *         description: Too many requests - rate limit exceeded
 *       500:
 *         description: Server error
 */
// Verify OTP
router.post("/verify-otp", registrationLimiter, async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: "Phone and OTP are required" });
    }

    const user = await User.findOne({ phone });

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Check if OTP exists, matches, and hasn't expired
    if (!user.otp || user.otp !== otp) {
      return res.status(401).json({ error: "Invalid OTP" });
    }

    if (new Date() > user.otpExpiry) {
      return res.status(401).json({ error: "OTP has expired" });
    }

    // Clear OTP after successful verification
    await User.findByIdAndUpdate(user._id, {
      otp: null,
      otpExpiry: null,
    });

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn },
    );

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Verify OTP error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Generic user registration
 *     description: Register a new user (patient or CHEW) with password. For testing purposes.
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
 *                 example: "password123"
 *               name:
 *                 type: string
 *                 example: "Test User"
 *               role:
 *                 type: string
 *                 enum: ["patient", "chew"]
 *                 example: "patient"
 *               preferredLanguage:
 *                 type: string
 *                 example: "en"
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error
 *       500:
 *         description: Server error
 */
router.post("/register", registrationLimiter, async (req, res) => {
  try {
    const {
      phone,
      password,
      name,
      role = "patient",
      preferredLanguage = "en",
    } = req.body;

    if (!phone || !password || !name) {
      return res
        .status(400)
        .json({ error: "Phone, password, and name required" });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ phone });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const newUser = await User.create({
      phone,
      password: hashedPassword,
      name,
      role,
      preferredLanguage,
    });

    // Generate token
    const token = jwt.sign(
      { userId: newUser._id, role: newUser.role },
      process.env.JWT_SECRET || "default-secret",
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
    );

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      token,
      user: {
        id: newUser._id,
        name: newUser.name,
        phone: newUser.phone,
        role: newUser.role,
      },
    });
  } catch (error) {
    console.error("Register user error:", error);
    res.status(500).json({ error: "Registration failed" });
  }
});

/**
 * @swagger
 * /api/v1/auth/register-chew:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Register new CHEW (Community Health Extension Worker)
 *     description: Create a new CHEW account with health centre assignment. Admin only.
 *     security: []
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
 *                 example: "+2348012345678"
 *               firstName:
 *                 type: string
 *                 example: "Chinedu"
 *               lastName:
 *                 type: string
 *                 example: "Okonkwo"
 *               password:
 *                 type: string
 *                 format: password
 *                 example: "SecurePassword123!"
 *               phcName:
 *                 type: string
 *                 description: Primary Healthcare Centre name
 *                 example: "Central PHC Gidi"
 *               lga:
 *                 type: string
 *                 description: Local Government Area
 *                 example: "Kosofe"
 *               state:
 *                 type: string
 *                 example: "Lagos"
 *     responses:
 *       201:
 *         description: CHEW registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: JWT authentication token
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
 *       400:
 *         description: Validation error or CHEW already exists
 *       500:
 *         description: Server error
 */
router.post("/register-chew", registrationLimiter, async (req, res) => {
  try {
    const { phone, firstName, lastName, password, phcName, lga, state } =
      req.body;

    // Validation
    if (!phone || !firstName || !lastName || !password || !phcName || !lga) {
      return res.status(400).json({
        error:
          "Phone, firstName, lastName, password, phcName, and lga are required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: "Password must be at least 8 characters long",
      });
    }

    // Check if CHEW already exists
    const existingChew = await User.findOne({ phone, role: "chew" });
    if (existingChew) {
      return res
        .status(400)
        .json({ error: "CHEW with this phone already exists" });
    }

    // Hash password using bcrypt
    const hashedPassword = await hashPassword(password);

    // Create CHEW user
    const newChew = await User.create({
      phone,
      name: `${firstName} ${lastName}`,
      firstName,
      lastName,
      password: hashedPassword,
      role: "chew",
      email: `${phone}@mamacheck.health`,
      verified: false,
      consent: {
        sms: true,
        dataProcessing: true,
      },
      optOut: {
        isOptedOut: false,
      },
    });

    // Create CHEW profile
    await CHEWProfile.create({
      userId: newChew._id,
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

    // Generate JWT token
    const token = jwt.sign(
      { userId: newChew._id, role: newChew.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN },
    );

    // Send welcome SMS (optional - can be enhanced later)
    console.log(
      `Welcome SMS would be sent to ${phone}: "Welcome to MamaCheck, ${firstName}! Your CHEW account is active at ${phcName}."`,
    );

    res.status(201).json({
      success: true,
      message: "CHEW registered successfully",
      token,
      user: {
        id: newChew._id,
        name: newChew.name,
        phone: newChew.phone,
        role: newChew.role,
      },
    });
  } catch (error) {
    console.error("Register CHEW error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
