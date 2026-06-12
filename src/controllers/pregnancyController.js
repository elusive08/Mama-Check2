import Pregnancy from "../models/Pregnancy.js";
import ANCPregnancy from "../models/ANCPregnancy.js";
import User from "../models/User.js";
import DangerReport from "../models/DangerReport.js";
import ANCVisitLog from "../models/ANCVisitLog.js";
import MessagingService from "../services/messagingService.js";
import GestationalAgeService from "../services/gestationalAgeService.js";
import logger from "../utils/logger.js";
import { hashPassword } from "../utils/passwordUtils.js";
import crypto from "node:crypto";

const BYPASS_OTP_FOR_TESTING =
  process.env.BYPASS_OTP_FOR_TESTING === "true" &&
  process.env.NODE_ENV !== "production";

const PHONE_REGEX = /^(\+?234|0)[789]\d{9}$/;
const VALID_LANGUAGES = ["en", "pidgin", "yo", "ha", "ig"];

class PregnancyController {
  /**
   * Register a new pregnancy (creates User + Pregnancy + ANC tracking)
   */
  async register(req, res) {
    try {
      const validatedData = this.validateRegistrationInput(req.body);
      if (validatedData.error) {
        return res.status(400).json({ error: validatedData.error });
      }

      const { woman, isNewUser } = await this.findOrCreateUser(validatedData);

      if (isNewUser) {
        await this.sendWelcomeOTP(woman);
      }

      const pregnancy = await this.createPregnancyRecord(
        woman,
        validatedData,
        req.user?._id,
      );
      await this.createANCRecord(pregnancy);

      if (!this.isTestEnvironment() && woman.phoneVerified) {
        await this.sendWelcomeMessage(pregnancy, woman);
      }

      res.status(201).json({
        success: true,
        message:
          "Patient registered successfully. Please verify phone via OTP.",
        pregnancyId: pregnancy._id,
        userId: woman._id,
        phoneVerified: woman.phoneVerified,
      });
    } catch (error) {
      logger.error("Registration error:", error);
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Validate and extract registration data
   */
  validateRegistrationInput(body) {
    const {
      firstName,
      lastName,
      phone,
      password,
      residentialAddress,
      lga,
      state,
      preferredLanguage = "en",
      lmp,
      edd,
      clinicName,
      trustedContactName,
      trustedContactPhone,
      trustedContactRelationship,
      trustedContactLanguage,
      otp,
    } = body;

    // Required fields validation
    if (!phone || !firstName || !lastName) {
      return { error: "Phone number, first name, and last name are required" };
    }

    if (!PHONE_REGEX.test(phone)) {
      return { error: "Invalid Nigerian phone number format" };
    }

    if (preferredLanguage && !VALID_LANGUAGES.includes(preferredLanguage)) {
      return {
        error: `preferredLanguage must be one of: ${VALID_LANGUAGES.join(", ")}`,
      };
    }

    // Pregnancy details validation
    if ((!lmp && !edd) || (lmp && edd)) {
      return { error: "Either LMP or EDD must be provided, not both" };
    }

    if (!clinicName) {
      return { error: "Clinic name is required" };
    }

    if (trustedContactPhone && !PHONE_REGEX.test(trustedContactPhone)) {
      return { error: "Invalid trusted contact phone number format" };
    }

    return {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone,
      password,
      residentialAddress: residentialAddress || null,
      lga: lga || null,
      state: state || null,
      preferredLanguage,
      lmp,
      edd,
      clinicName,
      trustedContactName,
      trustedContactPhone,
      trustedContactRelationship,
      trustedContactLanguage,
      otp,
    };
  }

  /**
   * Find existing user or create new one
   */
  async findOrCreateUser(data) {
    const existingUser = await User.findOne({ phone: data.phone });

    if (existingUser) {
      await this.updateExistingUser(existingUser, data);
      return { woman: existingUser, isNewUser: false };
    }

    const newUser = await this.createNewUser(data);
    return { woman: newUser, isNewUser: true };
  }

  /**
   * Update existing user with missing information
   */
  async updateExistingUser(user, data) {
    const updates = {};

    if (data.firstName && !user.firstName) updates.firstName = data.firstName;
    if (data.lastName && !user.lastName) updates.lastName = data.lastName;
    if (data.residentialAddress && !user.residentialAddress)
      updates.residentialAddress = data.residentialAddress;
    if (data.lga && !user.lga) updates.lga = data.lga;
    if (data.state && !user.state) updates.state = data.state;

    if (data.trustedContactName && !user.trustedContact?.name) {
      updates.trustedContact = {
        name: data.trustedContactName,
        phone: data.trustedContactPhone,
        relationship: data.trustedContactRelationship,
        preferredLanguage:
          data.trustedContactLanguage || data.preferredLanguage || "en",
      };
    }

    if (Object.keys(updates).length > 0) {
      await User.findByIdAndUpdate(user._id, { $set: updates });
    }

    logger.info(`Existing patient registered for new pregnancy: ${user._id}`);
  }

  /**
   * Create a new user account
   */
  async createNewUser(data) {
    if (!data.password) {
      throw new Error("Password is required for new patient registration");
    }

    if (data.password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    const hashedPassword = await hashPassword(data.password);
    const fullName = `${data.firstName} ${data.lastName}`;

    const user = new User({
      firstName: data.firstName,
      lastName: data.lastName,
      name: fullName,
      phone: data.phone,
      password: hashedPassword,
      role: "patient",
      preferredLanguage: data.preferredLanguage,
      residentialAddress: data.residentialAddress,
      lga: data.lga,
      state: data.state,
      street: data.residentialAddress,
      trustedContact: data.trustedContactName
        ? {
            name: data.trustedContactName,
            phone: data.trustedContactPhone,
            relationship: data.trustedContactRelationship,
            preferredLanguage:
              data.trustedContactLanguage || data.preferredLanguage || "en",
          }
        : null,
      phoneVerified: false,
      consent: {
        sms: true,
        dataProcessing: true,
        consentDate: new Date(),
      },
    });

    await user.save();
    logger.info(`New patient registered: ${user._id} - ${fullName}`);

    return user;
  }

  /**
   * Send OTP for phone verification
   */
  async sendWelcomeOTP(user) {
    const otp = crypto.randomInt(100000, 1000000).toString();

    await User.findByIdAndUpdate(user._id, {
      otp,
      otpExpiry: new Date(Date.now() + 5 * 60 * 1000),
    });

    await MessagingService.sendSMS({
      to: user.phone,
      content: `Welcome to MamaCheck! Your verification code is: ${otp}. Valid for 5 minutes.`,
      type: "otp",
    });
  }

  /**
   * Create pregnancy record
   */
  async createPregnancyRecord(user, data, chewId) {
    const gestationalAge = this.calculateGestationalAge(data.lmp, data.edd);

    const pregnancy = new Pregnancy({
      womanId: user._id,
      chewId: chewId || null,
      lmp: gestationalAge.lmp,
      edd: gestationalAge.edd,
      gestationalWeek: gestationalAge.weeks,
      clinicName: data.clinicName,
      registrationDate: new Date(),
      status: "active",
      lastCheckin: new Date(),
    });

    await pregnancy.save();
    return pregnancy;
  }

  /**
   * Calculate gestational age from LMP or EDD
   */
  calculateGestationalAge(lmp, edd) {
    if (lmp) {
      return GestationalAgeService.calculateGestationalAge(lmp, null);
    }
    return GestationalAgeService.calculateGestationalAge(null, edd);
  }

  /**
   * Create ANC tracking record
   */
  async createANCRecord(pregnancy) {
    const ancPregnancy = new ANCPregnancy({
      pregnancyId: pregnancy._id,
      fmohSchedule: this.generateFMOHSchedule(pregnancy.lmp),
    });
    await ancPregnancy.save();
    return ancPregnancy;
  }

  /**
   * Check if running in test environment
   */
  isTestEnvironment() {
    return process.env.NODE_ENV === "test";
  }

  generateFMOHSchedule(lmp) {
    const schedule = [];
    const milestones = [8, 12, 16, 20, 24, 28, 32, 36];

    milestones.forEach((week, index) => {
      const milestoneDate = new Date(lmp);
      milestoneDate.setDate(milestoneDate.getDate() + week * 7);

      schedule.push({
        weekNumber: week,
        milestoneNumber: index + 1,
        description: `ANC Visit ${index + 1}`,
        scheduledDate: milestoneDate,
        reminderSent: false,
        attended: false,
      });
    });

    return schedule;
  }

  async sendWelcomeMessage(pregnancy, woman) {
    const welcomeMessage = `Welcome to MamaCheck, ${woman.firstName || woman.name}! You'll receive weekly pregnancy tips and reminders for your ANC visits at ${pregnancy.clinicName}. Reply STOP to opt out. MamaCheck is a safety guide, not a doctor.`;

    await MessagingService.queueMessage({
      to: woman.phone,
      content: welcomeMessage,
      language: woman.preferredLanguage,
      type: "welcome",
      priority: "high",
      metadata: {
        pregnancyId: pregnancy._id,
        womanId: woman._id,
      },
    });
  }

  // ========== EXISTING METHODS (unchanged) ==========

  async markVisitAttended(req, res) {
    try {
      const { pregnancyId } = req.params;
      const { milestoneNumber } = req.body;

      if (!pregnancyId || !milestoneNumber) {
        return res
          .status(400)
          .json({ error: "Pregnancy ID and milestone number are required" });
      }

      const pregnancy = await Pregnancy.findById(pregnancyId);
      if (!pregnancy) {
        return res.status(404).json({ error: "Pregnancy not found" });
      }

      const ancPregnancy = await ANCPregnancy.findOne({ pregnancyId });
      if (!ancPregnancy) {
        return res.status(404).json({ error: "ANC record not found" });
      }

      const milestone = ancPregnancy.fmohSchedule.find(
        (m) => m.milestoneNumber === Number.parseInt(milestoneNumber),
      );

      if (!milestone) {
        return res
          .status(404)
          .json({ error: `Milestone ${milestoneNumber} not found` });
      }

      if (milestone.attended) {
        return res
          .status(400)
          .json({ error: "Visit already marked as attended" });
      }

      milestone.attended = true;
      milestone.attendedDate = new Date();
      await ancPregnancy.save();

      pregnancy.ancVisits.push({
        weekNumber: milestone.weekNumber,
        scheduledDate: milestone.scheduledDate,
        attendedDate: new Date(),
        status: "attended",
      });
      await pregnancy.save();

      const visitLog = new ANCVisitLog({
        pregnancyId,
        womanId: pregnancy.womanId,
        chewId: req.user._id,
        visitWeek: milestoneNumber,
        action: "marked_attended",
        markedAtDate: new Date(),
        markedAtTime: new Date(),
        canUndo: true,
      });
      await visitLog.save();

      res.json({
        success: true,
        message: `Visit ${milestoneNumber} marked as attended`,
      });
    } catch (error) {
      logger.error("Mark visit error:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getCHEWDashboard(req, res) {
    try {
      const { chewId } = req.params;
      const pregnancies = await Pregnancy.find({ chewId })
        .populate("womanId")
        .sort({ gestationalWeek: -1 });

      const dashboard = {
        summary: {
          total: pregnancies.length,
          dueThisWeek: pregnancies.filter((p) => {
            const nextVisit = p.ancVisits.find((v) => v.status === "scheduled");
            return nextVisit && this.isWithinWeek(nextVisit.scheduledDate);
          }).length,
          missedVisits: pregnancies.filter((p) =>
            p.ancVisits.some((v) => v.status === "missed"),
          ).length,
          openRedFlags: await DangerReport.countDocuments({
            pregnancyId: { $in: pregnancies.map((p) => p._id) },
            requiresFollowup: true,
            "followup.status": "pending",
          }),
        },
        pregnancies: pregnancies.map((p) => ({
          id: p._id,
          name: p.womanId.name,
          phone: p.womanId.phone,
          gestationalWeek: p.gestationalWeek,
          nextANCDue: this.getNextANCDue(p),
          redFlagStatus: p.requiresAttention,
          lastCheckin: p.lastCheckin,
        })),
      };

      res.json(dashboard);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  isWithinWeek(date) {
    const weekFromNow = new Date();
    weekFromNow.setDate(weekFromNow.getDate() + 7);
    return date <= weekFromNow;
  }

  getNextANCDue(pregnancy) {
    const nextVisit = pregnancy.ancVisits.find((v) => v.status === "scheduled");
    return nextVisit ? nextVisit.scheduledDate : null;
  }

  async getCHEWPregnancies(req, res) {
    try {
      const { chewId } = req.params;
      const pregnancies = await Pregnancy.find({ chewId })
        .populate("womanId", "name phone")
        .sort({ registrationDate: -1 });

      res.json({
        success: true,
        data: pregnancies.map((p) => ({
          id: p._id,
          womanName: p.womanId.name,
          phone: p.womanId.phone,
          gestationalWeek: p.gestationalWeek,
          status: p.status,
          clinicName: p.clinicName,
          registrationDate: p.registrationDate,
        })),
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getPregnancyById(req, res) {
    try {
      const { pregnancyId } = req.params;
      const pregnancy =
        await Pregnancy.findById(pregnancyId).populate("womanId");

      if (!pregnancy) {
        return res.status(404).json({ error: "Pregnancy not found" });
      }

      const ancPregnancy = await ANCPregnancy.findOne({ pregnancyId });

      res.json({
        success: true,
        data: {
          id: pregnancy._id,
          woman: pregnancy.womanId,
          lmp: pregnancy.lmp,
          edd: pregnancy.edd,
          gestationalWeek: pregnancy.gestationalWeek,
          status: pregnancy.status,
          clinicName: pregnancy.clinicName,
          ancSchedule: ancPregnancy?.fmohSchedule || [],
          registrationDate: pregnancy.registrationDate,
        },
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async updatePregnancy(req, res) {
    try {
      const { pregnancyId } = req.params;
      const { clinicName, status, riskFactors } = req.body;

      const pregnancy = await Pregnancy.findByIdAndUpdate(
        pregnancyId,
        {
          clinicName,
          status,
          riskFactors,
          lastUpdated: new Date(),
        },
        { new: true },
      );

      res.json({
        success: true,
        data: pregnancy,
      });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getDangerReports(req, res) {
    try {
      const { pregnancyId } = req.params;
      const reports = await DangerReport.find({ pregnancyId }).sort({
        timestamp: -1,
      });

      res.json({
        success: true,
        data: reports,
      });
    } catch (error) {
      console.error("Error fetching danger reports:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async undoVisitAttended(req, res) {
    try {
      const { pregnancyId } = req.params;
      const { milestoneNumber, reason } = req.body;

      if (!pregnancyId || !milestoneNumber) {
        return res
          .status(400)
          .json({ error: "Pregnancy ID and milestone number are required" });
      }

      const pregnancy = await Pregnancy.findById(pregnancyId);
      if (!pregnancy) {
        return res.status(404).json({ error: "Pregnancy not found" });
      }

      const recentLog = await ANCVisitLog.findOne({
        pregnancyId,
        visitWeek: milestoneNumber,
        action: "marked_attended",
      }).sort({ markedAtTime: -1 });

      if (!recentLog) {
        return res
          .status(400)
          .json({ error: "No recent attendance record found" });
      }

      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      if (recentLog.markedAtTime < tenMinutesAgo) {
        return res.status(400).json({
          error: "Undo window expired (10 minutes)",
          markedAt: recentLog.markedAtTime,
        });
      }

      const ancPregnancy = await ANCPregnancy.findOne({ pregnancyId });
      if (!ancPregnancy) {
        return res.status(404).json({ error: "ANC record not found" });
      }

      const milestone = ancPregnancy.fmohSchedule.find(
        (m) => m.milestoneNumber === Number.parseInt(milestoneNumber),
      );

      if (milestone) {
        milestone.attended = false;
        milestone.attendedDate = null;
        await ancPregnancy.save();
      }

      pregnancy.ancVisits = pregnancy.ancVisits.filter(
        (v) => !(v.weekNumber === milestoneNumber && v.status === "attended"),
      );
      await pregnancy.save();

      const undoLog = new ANCVisitLog({
        pregnancyId,
        womanId: pregnancy.womanId,
        chewId: pregnancy.chewId,
        visitWeek: milestoneNumber,
        action: "undone",
        markedAtDate: new Date(),
        undoReason: reason || "User request",
        undoTime: new Date(),
      });
      await undoLog.save();

      res.json({ success: true, message: "Attendance undone successfully" });
    } catch (error) {
      console.error("Undo attendance error:", error);
      res.status(500).json({ error: error.message });
    }
  }

  async getAttendanceHistory(req, res) {
    try {
      const { pregnancyId } = req.params;
      const { limit = 20, offset = 0 } = req.query;

      const pregnancy = await Pregnancy.findById(pregnancyId);
      if (!pregnancy) {
        return res.status(404).json({ error: "Pregnancy not found" });
      }

      const logs = await ANCVisitLog.find({ pregnancyId })
        .populate("chewId", "name")
        .sort({ markedAtTime: -1 })
        .skip(Number.parseInt(offset))
        .limit(Number.parseInt(limit));

      const total = await ANCVisitLog.countDocuments({ pregnancyId });

      const attendance = logs.map((log) => ({
        id: log._id,
        visitWeek: log.visitWeek,
        action: log.action,
        attendedDate: log.attendedDate,
        markedAtTime: log.markedAtTime,
        canUndo: log.canUndo,
        undoWindowExpires: log.undoWindowExpires,
        undoReason: log.undoReason,
        undoTime: log.undoTime,
        notes: log.notes,
        createdAt: log.createdAt,
        markedBy: log.chewId
          ? {
              id: log.chewId._id,
              name: log.chewId.name,
            }
          : null,
      }));

      res.json({
        success: true,
        data: attendance,
        pagination: {
          total,
          limit: Number.parseInt(limit),
          offset: Number.parseInt(offset),
          hasMore: Number.parseInt(offset) + Number.parseInt(limit) < total,
        },
      });
    } catch (error) {
      console.error("Error fetching attendance history:", error);
      res.status(500).json({ error: error.message });
    }
  }
}

export default new PregnancyController();
