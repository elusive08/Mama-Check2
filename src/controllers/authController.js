import User from "../models/User.js";
import CHEWProfile from "../models/CHEWProfile.js";
import SystemEvent from "../models/SystemEvent.js";
import logger from "../utils/logger.js";
import otpStore from "../utils/otpStore.js";
import crypto from "node:crypto";
import { hashPassword, comparePassword } from "../utils/passwordUtils.js";
import jwt from "jsonwebtoken";

class AuthController {
  /**
   * Generate tokens for a user
   */
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
   * Send OTP for phone verification
   */
  async sendOTP(req, res) {
    try {
      const { phone } = req.body;

      if (!phone) {
        return res.status(400).json({ error: "Phone number is required" });
      }

      // Validate Nigerian phone number format
      const phoneRegex = /^(\+?234|0)[789]\d{9}$/;
      if (!phoneRegex.test(phone)) {
        return res.status(400).json({ error: "Invalid phone number format" });
      }

      // Rate limiting
      const rateLimitKey = `otp:rl:${phone}`;
      const lastRequest = await otpStore.get(rateLimitKey);
      if (lastRequest) {
        return res.status(429).json({
          error: "Please wait 60 seconds before requesting another OTP",
        });
      }

      // Generate 6-digit OTP
      const otp = crypto.randomInt(100000, 1000000).toString();

      // Store OTP with 5-minute expiration
      await otpStore.set(
        phone,
        {
          otp,
          attempts: 0,
          verified: false,
        },
        300,
      );

      // Store rate limit info with 60-second expiration
      await otpStore.set(rateLimitKey, { timestamp: Date.now() }, 60);

      logger.info(`OTP generated for ${phone}`);

      res.status(200).json({
        success: true,
        message: "OTP sent successfully",
        expiresIn: 300,
      });
    } catch (error) {
      logger.error("Send OTP error:", error);
      res.status(500).json({ error: "Failed to send OTP" });
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

        // Find or create user
        let user = await User.findOne({ phone });
        if (!user) {
          user = new User({
            phone,
            role: "patient",
            phoneVerified: true,
            phoneVerifiedAt: new Date(),
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

      if (storedOTP.otp !== otp) {
        storedOTP.attempts++;
        await otpStore.set(phone, storedOTP, 300);
        return res.status(401).json({
          error: `Invalid OTP. ${3 - storedOTP.attempts} attempts remaining`,
        });
      }

      // Mark as verified
      storedOTP.verified = true;
      await otpStore.set(phone, storedOTP, 300);

      // Update user's phoneVerified status
      let user = await User.findOne({ phone });
      if (!user) {
        // Create user if doesn't exist
        user = new User({
          phone,
          role: "patient",
          phoneVerified: true,
          phoneVerifiedAt: new Date(),
        });
        await user.save();
      } else {
        user.phoneVerified = true;
        user.phoneVerifiedAt = new Date();
        await user.save();
      }

      logger.info(`OTP verified for ${phone}`);

      // Generate token for the user
      const { accessToken, refreshToken } = this.generateTokens(user);

      return res.status(200).json({
        success: true,
        token: accessToken,
        refreshToken,
        message: "OTP verified successfully",
      });
    } catch (error) {
      logger.error("Verify OTP error:", error);
      res.status(500).json({ error: "Failed to verify OTP" });
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

      res.status(200).json({
        success: true,
        accessToken,
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
      res.status(500).json({ error: "Login failed" });
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

      res.status(200).json({
        success: true,
        accessToken,
        refreshToken: newRefreshToken,
      });
    } catch (error) {
      logger.error("Refresh token error:", error);
      res.status(401).json({ error: "Invalid or expired refresh token" });
    }
  }

  /**
   * Logout user
   */
  async logout(req, res) {
    try {
      const token = req.token;
      if (token) {
        const decoded = jwt.decode(token);
        if (decoded && decoded.exp) {
          const ttl = decoded.exp - Math.floor(Date.now() / 1000);
          if (ttl > 0) {
            const redis = (await import("../config/redis.js")).default;
            await redis.setex(`revoked:${token}`, ttl, "true");
          }
        }
      }

      logger.info(`User logged out: ${req.user?._id}`);

      res.status(200).json({
        success: true,
        message: "Logged out successfully",
      });
    } catch (error) {
      logger.error("Logout error:", error);
      res.status(500).json({ error: "Logout failed" });
    }
  }

  /**
   * Change password
   */
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

      res.status(200).json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error) {
      logger.error("Change password error:", error);
      res.status(500).json({ error: "Failed to change password" });
    }
  }

  /**
   * Request password reset
   */
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

      // Generate raw reset token
      const rawResetToken = crypto.randomBytes(32).toString("hex");

      // Hash the token before storing in database
      const hashedToken = crypto
        .createHash("sha256")
        .update(rawResetToken)
        .digest("hex");

      const resetExpires = Date.now() + 3600000; // 1 hour

      // Store the HASHED token, not the raw token
      user.resetPasswordToken = hashedToken;
      user.resetPasswordExpires = resetExpires;
      await user.save();

      // In a real implementation, you would send the RAW token to the user via SMS
      // For development/testing, we can return it (remove in production)
      logger.info(`Password reset requested for ${phone}`);

      // For development only - in production, send via SMS
      if (process.env.NODE_ENV !== "production") {
        return res.status(200).json({
          success: true,
          message: "If an account exists, you will receive reset instructions",
          resetToken: rawResetToken, // Only for testing - remove in production
        });
      }

      res.status(200).json({
        success: true,
        message: "If an account exists, you will receive reset instructions",
      });
    } catch (error) {
      logger.error("Forgot password error:", error);
      res.status(500).json({ error: "Failed to process request" });
    }
  }

  /**
   * Reset password with token
   */
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

      // Hash the submitted token to compare with stored hash
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

      res.status(200).json({
        success: true,
        message: "Password reset successfully",
      });
    } catch (error) {
      logger.error("Reset password error:", error);
      res.status(500).json({ error: "Failed to reset password" });
    }
  }

  /**
   * Get current user profile
   */
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

      res.status(200).json({
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
      res.status(500).json({ error: "Failed to get profile" });
    }
  }

  /**
   * Update user profile
   */
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
        if (updates[key] !== undefined) {
          filteredUpdates[key] = updates[key];
        }
      }

      const user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: filteredUpdates },
        { new: true, runValidators: true },
      ).select("-password");

      logger.info(`Profile updated for user: ${user._id}`);

      res.status(200).json({
        success: true,
        user,
        message: "Profile updated successfully",
      });
    } catch (error) {
      logger.error("Update profile error:", error);
      res.status(500).json({ error: "Failed to update profile" });
    }
  }

  /**
   * Opt out from messages
   */
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

      logger.info(`User opted out: ${user._id}, reason: ${reason}`);

      res.status(200).json({
        success: true,
        message: "You have been opted out from all messages",
      });
    } catch (error) {
      logger.error("Opt out error:", error);
      res.status(500).json({ error: "Failed to opt out" });
    }
  }

  /**
   * Opt back in
   */
  async optIn(req, res) {
    try {
      const user = req.user;

      user.optOut = {
        isOptedOut: false,
        reason: null,
        date: null,
      };
      await user.save();

      logger.info(`User opted back in: ${user._id}`);

      res.status(200).json({
        success: true,
        message:
          "You have been opted back in. You will start receiving messages again.",
      });
    } catch (error) {
      logger.error("Opt in error:", error);
      res.status(500).json({ error: "Failed to opt in" });
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
