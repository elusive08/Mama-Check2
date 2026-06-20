import User from "../models/User.js";
import CHEWProfile from "../models/CHEWProfile.js";
import SystemEvent from "../models/SystemEvent.js";
import logger from "../utils/logger.js";
import otpStore from "../utils/otpStore.js";
import crypto from "node:crypto";
import { hashPassword, comparePassword } from "../utils/passwordUtils.js";
import jwt from "jsonwebtoken";
import redis from "../config/redis.js";
import messagingService from "../services/messagingService.js";

class AuthController {
  generateTokens(user) {
    const accessToken = jwt.sign(
      { userId: user._id, role: user.role, phone: user.phone },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "7d" },
    );
    const refreshToken = jwt.sign(
      { userId: user._id, type: "refresh" },
      process.env.JWT_SECRET,
      { expiresIn: "30d" },
    );
    return { accessToken, refreshToken };
  }

  /**
   * Register a new user account.
   *
   * Used by tests and CHEW onboarding flows to create a user directly
   * (without the OTP + pregnancy flow).
   *
   * Accepts an optional `role` field. Valid roles: patient, chew, supervisor, admin.
   * In production only admin callers should be able to set role to anything
   * other than "patient" — enforce that at the route level with requireAdmin.
   */
  async register(req, res) {
    try {
      const {
        phone,
        password,
        name,
        role = "patient",
        preferredLanguage = "en",
      } = req.body;

      if (!phone || !password) {
        return res
          .status(400)
          .json({ error: "Phone and password are required" });
      }

      const phoneRegex = /^(\+?234|0)[789]\d{9}$/;
      if (!phoneRegex.test(phone)) {
        return res.status(400).json({ error: "Invalid phone number format" });
      }

      const allowedRoles = ["patient", "chew", "supervisor", "admin"];
      const assignedRole = allowedRoles.includes(role) ? role : "patient";

      const existing = await User.findOne({ phone });
      if (existing) {
        // Return 409 so callers can fall back to login
        return res
          .status(409)
          .json({ error: "Phone number already registered" });
      }

      const hashedPassword = await hashPassword(password);

      const user = new User({
        phone,
        name: name || "",
        password: hashedPassword,
        role: assignedRole,
        preferredLanguage,
        phoneVerified: false,
        optOut: { isOptedOut: false },
        consent: { sms: true, dataProcessing: true, consentDate: new Date() },
      });

      await user.save();

      // Queue welcome SMS for onboarding
      if (assignedRole === "patient") {
        try {
          logger.info(`Queuing onboarding SMS for ${user._id}`);
          await messagingService.queueMessage({
            to: user.phone,
            content: `Welcome to MamaCheck! You will receive health reminders. Reply STOP to opt out.`,
            type: "welcome",
            language: user.preferredLanguage,
            priority: "normal"
          });
        } catch (smsError) {
          logger.error("Failed to queue onboarding SMS:", smsError);
          // We don't fail registration if SMS fails
        }
      }

      const { accessToken, refreshToken } = this.generateTokens(user);

      logger.info(`User registered: ${user._id} (role: ${assignedRole})`);

      return res.status(201).json({
        success: true,
        token: accessToken,
        refreshToken,
        user: {
          id: user._id,
          phone: user.phone,
          name: user.name,
          role: user.role,
        },
      });
      } catch (error) {
      logger.error("Register error:", error);
      return res.status(500).json({ error: "Registration failed" });
      }
      }

  /**
   * Send OTP for phone verification
   */
  async sendOTP(req, res) {
    try {
      const { phone } = req.body;

      if (!phone) {
        return res.status(400).json({ error: "Phone number is required" });
      }

      const phoneRegex = /^(\+?234|0)[789]\d{9}$/;
      if (!phoneRegex.test(phone)) {
        return res.status(400).json({ error: "Invalid phone number format" });
      }

      const rateLimitKey = `otp:rl:${phone}`;
      const lastRequest = await otpStore.get(rateLimitKey);
      if (lastRequest) {
        return res.status(429).json({
          error: "Please wait 60 seconds before requesting another OTP",
        });
      }

      const otp = crypto.randomInt(100000, 1000000).toString();

      await otpStore.set(phone, { otp, attempts: 0, verified: false }, 300);
      await otpStore.set(rateLimitKey, { timestamp: Date.now() }, 60);

      logger.info(`OTP generated for ${phone}`);

      return res.status(200).json({
        success: true,
        message: "OTP sent successfully",
        expiresIn: 300,
      });
    } catch (error) {
      logger.error("Send OTP error:", error);
      return res.status(500).json({ error: "Failed to send OTP" });
    }
  }

  /**
   * Verify OTP
   */
  async verifyOTP(req, res) {
    try {
      const { phone, otp } = req.body;

      if (!phone || !otp) {
        return res
          .status(400)
          .json({ error: "Phone number and OTP are required" });
      }

      // Test environment bypass
      const isTestEnv = process.env.NODE_ENV === "test";
      const bypassOtp =
        process.env.BYPASS_OTP_FOR_TESTING === "true" && isTestEnv;

      if (bypassOtp && otp.toString().length === 6) {
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

        const { accessToken, refreshToken } = this.generateTokens(user);
        return res.status(200).json({
          success: true,
          token: accessToken,
          refreshToken,
          message: "OTP verified successfully (test mode)",
        });
      }

      const storedOTP = await otpStore.get(phone);

      if (!storedOTP) {
        return res.status(400).json({ error: "OTP not found or expired" });
      }
      if (storedOTP.verified) {
        return res.status(400).json({ error: "OTP already verified" });
      }
      if (storedOTP.attempts >= 3) {
        await otpStore.delete(phone);
        return res.status(400).json({
          error: "Too many failed attempts. Please request a new OTP",
        });
      }

      // Timing-safe comparison
      const otpBuffer = Buffer.from(String(otp).padStart(6, "0"));
      const storedBuffer = Buffer.from(String(storedOTP.otp).padStart(6, "0"));
      const match =
        otpBuffer.length === storedBuffer.length &&
        crypto.timingSafeEqual(otpBuffer, storedBuffer);

      if (!match) {
        storedOTP.attempts++;
        await otpStore.set(phone, storedOTP, 300);
        return res.status(401).json({
          error: `Invalid OTP. ${3 - storedOTP.attempts} attempts remaining`,
        });
      }

      storedOTP.verified = true;
      await otpStore.set(phone, storedOTP, 300);

      let user = await User.findOne({ phone });
      if (user) {
        user.phoneVerified = true;
        user.phoneVerifiedAt = new Date();
        await user.save();
      } else {
        user = new User({
          phone,
          role: "patient",
          phoneVerified: true,
          phoneVerifiedAt: new Date(),
          optOut: { isOptedOut: false },
        });
        await user.save();
      }

      logger.info(`OTP verified for ${phone}`);
      const { accessToken, refreshToken } = this.generateTokens(user);

      return res.status(200).json({
        success: true,
        token: accessToken,
        refreshToken,
        message: "OTP verified successfully",
      });
    } catch (error) {
      logger.error("Verify OTP error:", error);
      return res.status(500).json({ error: "Failed to verify OTP" });
    }
  }

  /**
   * Login user
   */
  async login(req, res) {
    try {
      const { phone, password } = req.body;

      if (!phone || !password) {
        return res
          .status(400)
          .json({ error: "Phone and password are required" });
      }

      const user = await User.findOne({ phone });
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (user.optOut?.isOptedOut) {
        return res.status(401).json({ error: "Account has been deactivated" });
      }

      const isValidPassword = await comparePassword(password, user.password);
      if (!isValidPassword) {
        await this.logFailedLogin(user, req);
        return res.status(401).json({ error: "Invalid credentials" });
      }

      user.lastLoginAt = new Date();
      user.lastLoginIP = req.ip;
      await user.save();

      const { accessToken, refreshToken } = this.generateTokens(user);

      let chewProfile = null;
      if (user.role === "chew" || user.role === "supervisor") {
        chewProfile = await CHEWProfile.findOne({ userId: user._id });
      }

      logger.info(`User logged in: ${user._id} (${user.role})`);

      return res.status(200).json({
        success: true,
        accessToken,
        // Also expose as `token` so the test helper `loginRes.body.token` works
        token: accessToken,
        refreshToken,
        user: {
          id: user._id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          preferredLanguage: user.preferredLanguage,
          chewProfile: chewProfile
            ? {
                phcId: chewProfile.phcId,
                phcName: chewProfile.phcName,
                lga: chewProfile.lga,
                state: chewProfile.state,
                assignedWomenCount: chewProfile.assignedWomenCount,
              }
            : null,
        },
      });
    } catch (error) {
      logger.error("Login error:", error);
      return res.status(500).json({ error: "Login failed" });
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        return res.status(400).json({ error: "Refresh token required" });
      }

      const decoded = jwt.verify(refreshToken, process.env.JWT_SECRET);
      if (decoded.type !== "refresh") {
        return res.status(401).json({ error: "Invalid token type" });
      }

      const user = await User.findById(decoded.userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const { accessToken, refreshToken: newRefreshToken } =
        this.generateTokens(user);

      return res.status(200).json({
        success: true,
        accessToken,
        token: accessToken,
        refreshToken: newRefreshToken,
      });
    } catch (error) {
      logger.error("Refresh token error:", error);
      return res
        .status(401)
        .json({ error: "Invalid or expired refresh token" });
    }
  }

  /**
   * Logout — revoke token in Redis
   */
  async logout(req, res) {
    try {
      const token = req.token;
      if (token) {
        const decoded = jwt.decode(token);
        if (decoded?.exp) {
          const ttl = decoded.exp - Math.floor(Date.now() / 1000);
          if (ttl > 0) {
            // redis.setex(key, ttlSeconds, value)
            await redis.setex(`revoked:${token}`, ttl, "1");
          }
        }
      }

      logger.info(`User logged out: ${req.user?._id}`);
      return res
        .status(200)
        .json({ success: true, message: "Logged out successfully" });
    } catch (error) {
      logger.error("Logout error:", error);
      return res.status(500).json({ error: "Logout failed" });
    }
  }

  async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      const userId = req.user._id;

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

      const user = await User.findById(userId);
      const isValid = await comparePassword(currentPassword, user.password);
      if (!isValid) {
        return res.status(401).json({ error: "Current password is incorrect" });
      }

      user.password = await hashPassword(newPassword);
      user.passwordChangedAt = new Date();
      await user.save();

      logger.info(`Password changed for user: ${userId}`);
      return res
        .status(200)
        .json({ success: true, message: "Password changed successfully" });
    } catch (error) {
      logger.error("Change password error:", error);
      return res.status(500).json({ error: "Failed to change password" });
    }
  }

  async forgotPassword(req, res) {
    try {
      const { phone } = req.body;
      if (!phone) {
        return res.status(400).json({ error: "Phone number required" });
      }

      const user = await User.findOne({ phone });
      if (!user) {
        return res.status(200).json({
          success: true,
          message: "If an account exists, you will receive reset instructions",
        });
      }

      const rawResetToken = crypto.randomBytes(32).toString("hex");
      const hashedToken = crypto
        .createHash("sha256")
        .update(rawResetToken)
        .digest("hex");

      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = Date.now() + 3600000;
      await user.save();

      logger.info(`Password reset requested for ${phone}`);

      if (process.env.NODE_ENV !== "production") {
        return res.status(200).json({
          success: true,
          message: "If an account exists, you will receive reset instructions",
          resetToken: rawResetToken,
        });
      }

      return res.status(200).json({
        success: true,
        message: "If an account exists, you will receive reset instructions",
      });
    } catch (error) {
      logger.error("Forgot password error:", error);
      return res.status(500).json({ error: "Failed to process request" });
    }
  }

  async resetPassword(req, res) {
    try {
      const { token, newPassword } = req.body;
      if (!token || !newPassword) {
        return res
          .status(400)
          .json({ error: "Token and new password required" });
      }
      if (newPassword.length < 6) {
        return res
          .status(400)
          .json({ error: "Password must be at least 6 characters" });
      }

      const hashedToken = crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
      const user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: Date.now() },
      });

      if (!user) {
        return res
          .status(400)
          .json({ error: "Invalid or expired reset token" });
      }

      user.password = await hashPassword(newPassword);
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      user.passwordChangedAt = new Date();
      await user.save();

      logger.info(`Password reset for user: ${user._id}`);
      return res
        .status(200)
        .json({ success: true, message: "Password reset successfully" });
    } catch (error) {
      logger.error("Reset password error:", error);
      return res.status(500).json({ error: "Failed to reset password" });
    }
  }

  async getProfile(req, res) {
    try {
      const user = req.user;
      let chewProfile = null;

      if (user.role === "chew" || user.role === "supervisor") {
        chewProfile = await CHEWProfile.findOne({ userId: user._id });
      }

      const consentInfo = user.consent
        ? {
            sms: user.consent.sms,
            dataProcessing: user.consent.dataProcessing,
            hasConsented: true,
          }
        : { hasConsented: false };

      return res.status(200).json({
        success: true,
        user: {
          id: user._id,
          name: user.name,
          phone: user.phone,
          email: user.email,
          address: user.address,
          preferredLanguage: user.preferredLanguage,
          role: user.role,
          trustedContact: user.trustedContact,
          consent: consentInfo,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
          phoneVerified: user.phoneVerified,
          chewProfile: chewProfile
            ? {
                phcId: chewProfile.phcId,
                phcName: chewProfile.phcName,
                lga: chewProfile.lga,
                state: chewProfile.state,
                assignedWomenCount: chewProfile.assignedWomenCount,
                performance: chewProfile.performance,
              }
            : null,
        },
      });
    } catch (error) {
      logger.error("Get profile error:", error);
      return res.status(500).json({ error: "Failed to get profile" });
    }
  }

  async updateProfile(req, res) {
    try {
      const updates = req.body;
      const allowedUpdates = [
        "name",
        "email",
        "address",
        "preferredLanguage",
        "trustedContact",
      ];
      const filteredUpdates = {};
      for (const key of allowedUpdates) {
        if (updates[key] !== undefined) filteredUpdates[key] = updates[key];
      }

      const user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: filteredUpdates },
        { new: true, runValidators: true },
      ).select("-password");

      logger.info(`Profile updated for user: ${user._id}`);
      return res
        .status(200)
        .json({ success: true, user, message: "Profile updated successfully" });
    } catch (error) {
      logger.error("Update profile error:", error);
      return res.status(500).json({ error: "Failed to update profile" });
    }
  }

  async optOut(req, res) {
    try {
      const { reason } = req.body;
      const user = req.user;

      user.optOut = {
        isOptedOut: true,
        reason: reason || "User requested",
        date: new Date(),
      };
      await user.save();

      logger.info(`User opted out: ${user._id}`);
      return res.status(200).json({
        success: true,
        message: "You have been opted out from all messages",
      });
    } catch (error) {
      logger.error("Opt out error:", error);
      return res.status(500).json({ error: "Failed to opt out" });
    }
  }

  async optIn(req, res) {
    try {
      const user = req.user;
      user.optOut = { isOptedOut: false, reason: null, date: null };
      await user.save();

      logger.info(`User opted back in: ${user._id}`);
      return res.status(200).json({
        success: true,
        message:
          "You have been opted back in. You will start receiving messages again.",
      });
    } catch (error) {
      logger.error("Opt in error:", error);
      return res.status(500).json({ error: "Failed to opt in" });
    }
  }

  async logFailedLogin(user, req) {
    await SystemEvent.create({
      type: "AUTH_FAILURE",
      severity: "LOW",
      message: `Failed login attempt for ${user.phone}`,
      details: {
        userId: user._id,
        ip: req.ip,
        userAgent: req.get("user-agent"),
      },
    });
  }
}

export default new AuthController();
