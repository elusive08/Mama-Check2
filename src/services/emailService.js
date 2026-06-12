import { Resend } from "resend";
import logger from "../utils/logger.js";

// Initialize Resend with API key
const resend = new Resend(process.env.RESEND_API_KEY);

// Email templates
const EMAIL_TEMPLATES = {
  RESET_LINK: "password-reset",
  WELCOME: "welcome",
  OTP_CODE: "otp-verification",
  CHEW_WELCOME: "chew-welcome",
  ADMIN_WELCOME: "admin-welcome",
};

class EmailService {
  constructor() {
    this.fromEmail = process.env.FROM_EMAIL || "noreply@mamacheck.com";
    this.isEnabled = process.env.EMAIL_ENABLED === "true";
    this.isProduction = process.env.NODE_ENV === "production";
  }

  /**
   * Send a password reset email
   * @param {string} to - Recipient email
   * @param {string} resetToken - Password reset token
   * @param {string} name - User's name
   */
  async sendPasswordResetEmail(to, resetToken, name) {
    // Add debug logging
    console.log(`[EMAIL DEBUG] Attempting to send reset email to: ${to}`);
    console.log(`[EMAIL DEBUG] Email enabled: ${this.isEnabled}`);
    console.log(
      `[EMAIL DEBUG] RESEND_API_KEY exists: ${!!process.env.RESEND_API_KEY}`,
    );
    console.log(`[EMAIL DEBUG] From email: ${this.fromEmail}`);

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    console.log(`[EMAIL DEBUG] Reset URL: ${resetUrl}`);

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Password Reset - MamaCheck</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .button { 
            display: inline-block; 
            padding: 12px 24px; 
            background: #4CAF50; 
            color: white; 
            text-decoration: none; 
            border-radius: 4px; 
            margin: 20px 0;
          }
          .footer { font-size: 12px; text-align: center; padding: 20px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>MamaCheck</h1>
          </div>
          <div class="content">
            <h2>Password Reset Request</h2>
            <p>Hello ${name || "User"},</p>
            <p>We received a request to reset your password for your MamaCheck account.</p>
            <p>Click the button below to create a new password:</p>
            <p style="text-align: center;">
              <a href="${resetUrl}" class="button">Reset Password</a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p><code>${resetUrl}</code></p>
            <p>This link will expire in 1 hour.</p>
            <p>If you didn't request this, please ignore this email.</p>
            <hr>
            <p><strong>Security Tip:</strong> Never share this link with anyone.</p>
          </div>
          <div class="footer">
            <p>MamaCheck - Safe Pregnancy Monitoring</p>
            <p>© ${new Date().getFullYear()} MamaCheck. All rights reserved.</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
      Password Reset Request for MamaCheck
      
      Hello ${name || "User"},
      
      We received a request to reset your password.
      
      Click this link to reset your password:
      ${resetUrl}
      
      This link will expire in 1 hour.
      
      If you didn't request this, please ignore this email.
      
      MamaCheck - Safe Pregnancy Monitoring
    `;

    return this.sendEmail(to, "Reset Your MamaCheck Password", html, text);
  }

  /**
   * Send OTP verification email
   * @param {string} to - Recipient email
   * @param {string} otp - One-time password
   * @param {string} name - User's name
   */
  async sendOTPEmail(to, otp, name) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Verify Your Email - MamaCheck</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; text-align: center; }
          .otp-code { 
            font-size: 32px; 
            font-weight: bold; 
            letter-spacing: 5px; 
            background: #fff; 
            padding: 15px; 
            border-radius: 8px;
            display: inline-block;
            margin: 20px 0;
          }
          .footer { font-size: 12px; text-align: center; padding: 20px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>MamaCheck</h1>
          </div>
          <div class="content">
            <h2>Verify Your Email Address</h2>
            <p>Hello ${name || "User"},</p>
            <p>Use the verification code below to complete your registration:</p>
            <div class="otp-code">${otp}</div>
            <p>This code will expire in <strong>5 minutes</strong>.</p>
            <p>If you didn't create an account, you can safely ignore this email.</p>
          </div>
          <div class="footer">
            <p>MamaCheck - Safe Pregnancy Monitoring</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
      Verify Your Email Address - MamaCheck
      
      Hello ${name || "User"},
      
      Your verification code is: ${otp}
      
      This code will expire in 5 minutes.
      
      If you didn't create an account, you can safely ignore this email.
      
      MamaCheck - Safe Pregnancy Monitoring
    `;

    return this.sendEmail(to, "Verify Your MamaCheck Account", html, text);
  }

  /**
   * Send welcome email to new user
   * @param {string} to - Recipient email
   * @param {string} name - User's name
   * @param {string} role - User role (patient, chew, admin)
   */
  async sendWelcomeEmail(to, name, role = "patient") {
    const roleSpecificContent = {
      patient: {
        title: "Welcome to MamaCheck!",
        message:
          "You are now registered for pregnancy monitoring. You will receive weekly check-ins and important reminders about your ANC visits.",
      },
      chew: {
        title: "Welcome to MamaCheck - CHEW Portal!",
        message:
          "You are now registered as a Community Health Worker. You can now register pregnant women, track ANC visits, and respond to alerts.",
      },
      admin: {
        title: "Welcome to MamaCheck - Admin Portal!",
        message:
          "You have been granted administrative access. You can manage users, view analytics, and configure system settings.",
      },
    };

    const content = roleSpecificContent[role] || roleSpecificContent.patient;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Welcome to MamaCheck</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #4CAF50; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background: #f9f9f9; }
          .button { 
            display: inline-block; 
            padding: 12px 24px; 
            background: #4CAF50; 
            color: white; 
            text-decoration: none; 
            border-radius: 4px; 
            margin: 20px 0;
          }
          .footer { font-size: 12px; text-align: center; padding: 20px; color: #666; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>MamaCheck</h1>
          </div>
          <div class="content">
            <h2>${content.title}</h2>
            <p>Hello ${name || "User"},</p>
            <p>${content.message}</p>
            <p style="text-align: center;">
              <a href="${process.env.FRONTEND_URL}/login" class="button">Login to Your Account</a>
            </p>
            <hr>
            <p><strong>Need help?</strong> Contact your local health worker or reply to this email.</p>
          </div>
          <div class="footer">
            <p>MamaCheck - Safe Pregnancy Monitoring</p>
          </div>
        </div>
      </body>
      </html>
    `;

    const text = `
      ${content.title}
      
      Hello ${name || "User"},
      
      ${content.message}
      
      Login to your account: ${process.env.FRONTEND_URL}/login
      
      MamaCheck - Safe Pregnancy Monitoring
    `;

    return this.sendEmail(
      to,
      `Welcome to MamaCheck, ${name || "User"}!`,
      html,
      text,
    );
  }

  /**
   * Send email using Resend
   * @param {string} to - Recipient email
   * @param {string} subject - Email subject
   * @param {string} html - HTML content
   * @param {string} text - Plain text content (optional)
   */
  async sendEmail(to, subject, html, text = null) {
    // Skip if email is disabled
    if (!this.isEnabled) {
      logger.info(`Email disabled. Would send to ${to}: ${subject}`);
      return {
        success: true,
        mock: true,
        message: "Email disabled (mock mode)",
      };
    }

    // Skip if no API key in production
    if (this.isProduction && !process.env.RESEND_API_KEY) {
      logger.error("RESEND_API_KEY not configured in production");
      return { success: false, error: "Email service not configured" };
    }

    try {
      const { data, error } = await resend.emails.send({
        from: this.fromEmail,
        to: [to],
        subject: subject,
        html: html,
        text: text || this.convertHtmlToText(html),
      });

      if (error) {
        logger.error("Resend email error:", error);
        return { success: false, error: error.message };
      }

      logger.info(`Email sent to ${to}: ${subject} (ID: ${data?.id})`);
      return { success: true, messageId: data?.id };
    } catch (error) {
      logger.error("Failed to send email:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Simple HTML to plain text conversion
   * @param {string} html - HTML content
   * @returns {string} Plain text
   */
  convertHtmlToText(html) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Check if email service is configured and working
   */
  async healthCheck() {
    if (!process.env.RESEND_API_KEY) {
      return { configured: false, error: "RESEND_API_KEY not set" };
    }

    try {
      // Simple test - try to get domain info (doesn't send email)
      const domains = await resend.domains.list();
      return {
        configured: true,
        healthy: true,
        domains: domains.data?.length || 0,
      };
    } catch (error) {
      return { configured: true, healthy: false, error: error.message };
    }
  }
}

export default new EmailService();
