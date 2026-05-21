import Pregnancy from "../models/Pregnancy.js";
import ANCPregnancy from "../models/ANCPregnancy.js";
import User from "../models/User.js";
import DangerReport from "../models/DangerReport.js";
import MessagingService from "../services/messagingService.js";
import GestationalAgeService from "../services/gestationalAgeService.js";
import { verifyOTP } from "../utils/otp.js";

class PregnancyController {
  /**
   * Register a new pregnancy
   */
  async register(req, res) {
    try {
      const { womanDetails, lmp, edd, clinicName, chewId } = req.body;

      // Validate phone number with OTP
      const otpValid = await verifyOTP(womanDetails.phone, req.body.otp);
      if (!otpValid) {
        return res.status(400).json({ error: "Invalid OTP" });
      }

      // Create or get user
      let woman = await User.findOne({ phone: womanDetails.phone });
      if (!woman) {
        woman = new User({
          ...womanDetails,
          role: "patient",
          consent: {
            sms: true,
            dataProcessing: true,
          },
        });
        await woman.save();
      }

      // Calculate gestational age
      const gestationalAge = GestationalAgeService.calculateGestationalAge(
        lmp,
        edd,
      );

      // Create pregnancy record
      const pregnancy = new Pregnancy({
        womanId: woman._id,
        chewId: chewId,
        lmp: lmp || gestationalAge.lmp,
        edd: edd || gestationalAge.edd,
        gestationalWeek: gestationalAge.weeks,
        clinicName: clinicName,
        registrationDate: new Date(),
        status: "active",
        lastCheckin: new Date(),
      });

      await pregnancy.save();

      // Create ANC tracking record
      const ancPregnancy = new ANCPregnancy({
        pregnancyId: pregnancy._id,
        fmohSchedule: this.generateFMOHSchedule(pregnancy.lmp),
      });
      await ancPregnancy.save();

      // Send welcome message
      await this.sendWelcomeMessage(pregnancy, woman);

      res.status(201).json({
        success: true,
        pregnancyId: pregnancy._id,
        message: "Registration successful",
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ error: error.message });
    }
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
    const welcomeMessage = `Welcome to MamaCheck, ${woman.name}! You'll receive weekly pregnancy tips and reminders for your ANC visits at ${pregnancy.clinicName}. Reply STOP to opt out. MamaCheck is a safety guide, not a doctor.`;

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

  /**
   * Mark ANC visit as attended
   */
  async markVisitAttended(req, res) {
    try {
      const { pregnancyId, milestoneNumber } = req.body;

      const pregnancy = await Pregnancy.findById(pregnancyId);
      if (!pregnancy) {
        return res.status(404).json({ error: "Pregnancy not found" });
      }

      const ancPregnancy = await ANCPregnancy.findOne({ pregnancyId });
      const milestone = ancPregnancy.fmohSchedule.find(
        (m) => m.milestoneNumber === milestoneNumber,
      );

      if (milestone) {
        milestone.attended = true;
        milestone.attendedDate = new Date();
        await ancPregnancy.save();

        // Update pregnancy ANC visits
        pregnancy.ancVisits.push({
          weekNumber: milestone.weekNumber,
          scheduledDate: milestone.scheduledDate,
          attendedDate: new Date(),
          status: "attended",
        });
        await pregnancy.save();
      }

      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get dashboard data for CHEW
   */
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

  /**
   * Get all pregnancies for CHEW
   */
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

  /**
   * Get single pregnancy by ID
   */
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

  /**
   * Update pregnancy information
   */
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

  /**
   * Get danger reports for pregnancy
   */
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

  /**
   * Undo visit attendance (within 10 minutes)
   */
  async undoVisitAttended(req, res) {
    try {
      const { pregnancyId, milestoneNumber } = req.body;
      const ANCVisitLog = (await import("../models/ANCVisitLog.js")).default;

      const pregnancy = await Pregnancy.findById(pregnancyId);
      if (!pregnancy) {
        return res.status(404).json({ error: "Pregnancy not found" });
      }

      // Check if undo is within 10-minute window
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

      // Undo the attendance
      const ancPregnancy = await ANCPregnancy.findOne({ pregnancyId });
      const milestone = ancPregnancy.fmohSchedule.find(
        (m) => m.milestoneNumber === milestoneNumber,
      );

      if (milestone) {
        milestone.attended = false;
        milestone.attendedDate = null;
        await ancPregnancy.save();
      }

      // Remove from pregnancy ancVisits
      pregnancy.ancVisits = pregnancy.ancVisits.filter(
        (v) => !(v.weekNumber === milestoneNumber && v.status === "attended"),
      );
      await pregnancy.save();

      // Log the undo
      const undoLog = new ANCVisitLog({
        pregnancyId,
        womanId: pregnancy.womanId,
        chewId: pregnancy.chewId,
        visitWeek: milestoneNumber,
        action: "undone",
        markedAtDate: new Date(),
        undoReason: req.body.reason || "User request",
        undoTime: new Date(),
      });
      await undoLog.save();

      res.json({ success: true, message: "Attendance undone successfully" });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  /**
   * Get attendance history with undo availability
   */
  async getAttendanceHistory(req, res) {
    try {
      const { pregnancyId } = req.params;
      const ANCVisitLog = (await import("../models/ANCVisitLog.js")).default;

      const logs = await ANCVisitLog.find({ pregnancyId }).sort({
        createdAt: -1,
      });

      const attendance = logs.map((log) => ({
        visitWeek: log.visitWeek,
        action: log.action,
        markedAt: log.markedAtTime,
        canUndo: log.canUndo && log.action === "marked_attended",
        undoWindowExpires: log.canUndo
          ? new Date(log.markedAtTime.getTime() + 10 * 60 * 1000)
          : null,
      }));

      res.json(attendance);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

export default new PregnancyController();
