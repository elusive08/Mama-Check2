import User from "../models/User.js";
import CHEWProfile from "../models/CHEWProfile.js";
import SystemEvent from "../models/SystemEvent.js";
import authMiddleware from "../middleware/auth.js";
import logger from "../utils/logger.js";
import otpStore from "../utils/otpStore.js";
import crypto from "node:crypto";
import { hashPassword, comparePassword } from "../utils/passwordUtils.js";

class AuthController {
  /**
   * Send OTP for phone verification
   */
  async sendOTP(req, res) {
    try {
      const { phone } = req.body;

      if (!phone) {
        return res.status(400).json({ error: "Phone number is required" });
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
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

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

      // In production, send via SMS
      // await messagingService.sendTemplatedMessage('otp', phone, { otp }, 'en');

      logger.info(`OTP generated for ${phone}`); // Don't log actual OTP in production

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
        return res.status(400).json({
          error: `Invalid OTP. ${3 - storedOTP.attempts} attempts remaining`,
        });
      }

      // Mark as verified
      storedOTP.verified = true;
      await otpStore.set(phone, storedOTP, 300);

      logger.info(`OTP verified for ${phone}`);

      res.status(200).json({
        success: true,
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

      // Find user
      const user = await User.findOne({ phone });
      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Check if user is opted out
      if (user.optOut?.isOptedOut) {
        return res.status(401).json({ error: "Account has been deactivated" });
      }

      // Verify password (use bcrypt in production)
      const isValidPassword = await this.verifyPassword(
        password,
        user.password,
      );
      if (!isValidPassword) {
        // Log failed attempt
        await this.logFailedLogin(user, req);
        return res.status(401).json({ error: "Invalid credentials" });
      }

      // Update last login
      user.lastLoginAt = new Date();
      user.lastLoginIP = req.ip;
      await user.save();

      // Generate tokens
      const { accessToken, refreshToken } = authMiddleware.generateTokens(user);

      // Get CHEW profile if applicable
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

      const tokens = await authMiddleware.refreshAccessToken(refreshToken);

      res.status(200).json({
        success: true,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
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
        await authMiddleware.revokeToken(token);
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

      // Hash new password with bcrypt
      user.password = await hashPassword(newPassword);
      user.passwordChangedAt = new Date();
      await user.save();

      // Revoke all tokens
      // In production, invalidate all user sessions

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
        // Don't reveal if user exists for security
        return res.status(200).json({
          success: true,
          message: "If an account exists, you will receive reset instructions",
        });
      }

      // Generate reset token
      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetExpires = Date.now() + 3600000; // 1 hour

      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = resetExpires;
      await user.save();

      // Send reset link via SMS
      // await messagingService.sendTemplatedMessage('password_reset', phone, {
      //   token: resetToken
      // }, user.preferredLanguage);

      logger.info(`Password reset requested for ${phone}`);

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

      const user = await User.findOne({
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: Date.now() },
      });

      if (!user) {
        return res
          .status(400)
          .json({ error: "Invalid or expired reset token" });
      }

      // Update password
      user.password = await this.hashPassword(newPassword);
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
          consent: user.consent,
          createdAt: user.createdAt,
          lastLoginAt: user.lastLoginAt,
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

  cleanupExpiredOTPs() {
    const now = Date.now();
    for (const [key, value] of this.otpStore.entries()) {
      if (value.expiresAt && value.expiresAt < now) {
        this.otpStore.delete(key);
      }
    }
  }
}

export default new AuthController();
