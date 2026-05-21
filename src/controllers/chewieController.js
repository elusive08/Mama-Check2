import CHEWProfile from "../models/CHEWProfile.js";
import User from "../models/User.js";
import Pregnancy from "../models/Pregnancy.js";
import ANCPregnancy from "../models/ANCPregnancy.js";
import DangerReport from "../models/DangerReport.js";
import SystemEvent from "../models/SystemEvent.js";
import MessageQueue from "../models/MessageQueue.js";
import logger from "../utils/logger.js";

class CHEWController {
  /**
   * Create CHEW profile (admin only)
   */
  async createCHEWProfile(req, res) {
    try {
      const {
        userId,
        phcId,
        phcName,
        phcAddress,
        lga,
        state,
        supervisorId,
        registrationCode,
      } = req.body;

      // Check if CHEW already exists
      const existing = await CHEWProfile.findOne({
        $or: [{ userId }, { registrationCode }],
      });
      if (existing) {
        return res.status(400).json({ error: "CHEW profile already exists" });
      }

      // Get user
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Update user role
      user.role = "chew";
      await user.save();

      // Create CHEW profile
      const chewProfile = new CHEWProfile({
        userId,
        phcId,
        phcName,
        phcAddress,
        lga,
        state,
        supervisorId,
        registrationCode: registrationCode || this.generateRegistrationCode(),
        isActive: true,
        settings: {
          smsAlerts: true,
          dailyDigest: true,
          language: user.preferredLanguage || "en",
        },
      });

      await chewProfile.save();

      logger.info(`CHEW profile created for user: ${userId}`);

      res.status(201).json({
        success: true,
        chewProfile,
        message: "CHEW profile created successfully",
      });
    } catch (error) {
      logger.error("Create CHEW profile error:", error);
      res.status(500).json({ error: "Failed to create CHEW profile" });
    }
  }

  /**
   * Get CHEW dashboard data
   */
  async getDashboard(req, res) {
    try {
      const chewId = req.user._id;
      const chewProfile = await CHEWProfile.findOne({ userId: chewId });

      if (!chewProfile) {
        return res.status(404).json({ error: "CHEW profile not found" });
      }

      // Get all pregnancies assigned to this CHEW
      const pregnancies = await Pregnancy.find({ chewId })
        .populate("womanId", "name phone preferredLanguage")
        .sort({ gestationalWeek: -1 });

      // Calculate statistics
      const totalWomen = pregnancies.length;
      const activePregnancies = pregnancies.filter(
        (p) => p.status === "active",
      ).length;

      // Get ANC completion stats
      let totalVisitsCompleted = 0;
      let totalScheduledVisits = 0;
      for (const pregnancy of pregnancies) {
        const ancPregnancy = await ANCPregnancy.findOne({
          pregnancyId: pregnancy._id,
        });
        if (ancPregnancy) {
          totalVisitsCompleted += ancPregnancy.fmohSchedule.filter(
            (v) => v.attended,
          ).length;
          totalScheduledVisits += ancPregnancy.fmohSchedule.length;
        }
      }

      const ancCompletionRate =
        totalScheduledVisits > 0
          ? (totalVisitsCompleted / totalScheduledVisits) * 100
          : 0;

      // Get open red flags
      const openRedFlags = await DangerReport.find({
        chewId,
        triageOutcome: "RED",
        "followup.status": "pending",
      }).populate("womanId", "name phone");

      // Get upcoming visits (next 7 days)
      const upcomingVisits = await this.getUpcomingVisits(chewId, 7);

      // Get weekly check-in responses (last 7 days)
      const weeklyResponses = await DangerReport.countDocuments({
        chewId,
        timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
      });

      // Update CHEW performance metrics
      chewProfile.performance.ancCompletionRate = ancCompletionRate;
      chewProfile.performance.redFlagResponseRate =
        await this.calculateResponseRate(chewId);
      chewProfile.performance.lastMonthMetrics = {
        ancVisitsConducted: totalVisitsCompleted,
        redFlagsResponded: await DangerReport.countDocuments({
          chewId,
          "followup.status": "completed",
          timestamp: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        }),
        womenRegistered: await Pregnancy.countDocuments({
          chewId,
          registrationDate: {
            $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        }),
      };
      await chewProfile.save();

      const dashboard = {
        summary: {
          totalWomen,
          activePregnancies,
          ancCompletionRate: Math.round(ancCompletionRate),
          openRedFlags: openRedFlags.length,
          weeklyResponses,
          upcomingVisits: upcomingVisits.length,
        },
        recentAlerts: openRedFlags.slice(0, 10).map((flag) => ({
          id: flag._id,
          womanName: flag.womanId?.name,
          symptoms: flag.reportedSymptoms,
          timestamp: flag.timestamp,
          severity: flag.triageOutcome,
        })),
        upcomingVisits: upcomingVisits.slice(0, 10).map((visit) => ({
          pregnancyId: visit.pregnancy._id,
          womanName: visit.pregnancy.womanId?.name,
          weekNumber: visit.visit.weekNumber,
          scheduledDate: visit.visit.scheduledDate,
          milestoneNumber: visit.visit.milestoneNumber,
        })),
        performance: chewProfile.performance,
        recentRegistrations: pregnancies.slice(0, 5).map((p) => ({
          id: p._id,
          name: p.womanId?.name,
          phone: p.womanId?.phone,
          gestationalWeek: p.gestationalWeek,
          registrationDate: p.registrationDate,
        })),
      };

      res.status(200).json({
        success: true,
        dashboard,
      });
    } catch (error) {
      logger.error("Get CHEW dashboard error:", error);
      res.status(500).json({ error: "Failed to get dashboard data" });
    }
  }

  /**
   * Get all women assigned to CHEW
   */
  async getAssignedWomen(req, res) {
    try {
      const chewId = req.user._id;
      const { page = 1, limit = 20, status, search } = req.query;

      const query = { chewId };
      if (status) query.status = status;

      // Build base query
      let womenQuery = Pregnancy.find(query)
        .populate(
          "womanId",
          "name phone preferredLanguage address trustedContact",
        )
        .sort({ createdAt: -1 })
        .skip((page - 1) * Number.parseInt(limit))
        .limit(Number.parseInt(limit));

      if (search) {
        const women = await User.find({
          $or: [
            { name: { $regex: search, $options: "i" } },
            { phone: { $regex: search, $options: "i" } },
          ],
        }).select("_id");

        if (women.length > 0) {
          womenQuery = womenQuery.where("womanId").in(women.map((w) => w._id));
        }
      }

      const pregnancies = await womenQuery;
      const total = await Pregnancy.countDocuments(query);

      // Enrich with ANC data safely
      const enrichedPregnancies = [];
      for (const pregnancy of pregnancies) {
        try {
          // Skip if womanId is not populated
          if (!pregnancy.womanId) {
            console.log(`Skipping pregnancy ${pregnancy._id} - no womanId`);
            continue;
          }

          const ancPregnancy = await ANCPregnancy.findOne({
            pregnancyId: pregnancy._id,
          });
          const lastCheckin = await DangerReport.findOne({
            pregnancyId: pregnancy._id,
          }).sort({ timestamp: -1 });

          const hasRedFlags = await DangerReport.exists({
            pregnancyId: pregnancy._id,
            triageOutcome: "RED",
            "followup.status": "pending",
          });

          enrichedPregnancies.push({
            id: pregnancy._id,
            woman: {
              id: pregnancy.womanId._id,
              name: pregnancy.womanId.name || "Unknown",
              phone: pregnancy.womanId.phone || "Unknown",
              preferredLanguage: pregnancy.womanId.preferredLanguage || "en",
              trustedContact: pregnancy.womanId.trustedContact || null,
            },
            gestationalWeek: pregnancy.gestationalWeek || 0,
            edd: pregnancy.edd || null,
            status: pregnancy.status || "unknown",
            registrationDate: pregnancy.registrationDate,
            ancVisits: {
              completed:
                ancPregnancy?.fmohSchedule?.filter((v) => v.attended).length ||
                0,
              total: ancPregnancy?.fmohSchedule?.length || 8,
              nextVisit:
                ancPregnancy?.fmohSchedule?.find((v) => !v.attended) || null,
            },
            lastCheckin: lastCheckin?.timestamp || null,
            hasRedFlags: hasRedFlags || false,
          });
        } catch (err) {
          console.error(`Error enriching pregnancy ${pregnancy._id}:`, err);
          // Still add basic info
          enrichedPregnancies.push({
            id: pregnancy._id,
            woman: {
              id: pregnancy.womanId?._id || "unknown",
              name: pregnancy.womanId?.name || "Unknown",
              phone: pregnancy.womanId?.phone || "Unknown",
            },
            gestationalWeek: pregnancy.gestationalWeek || 0,
            status: pregnancy.status || "unknown",
            registrationDate: pregnancy.registrationDate,
            ancVisits: { completed: 0, total: 8, nextVisit: null },
            lastCheckin: null,
            hasRedFlags: false,
          });
        }
      }

      res.status(200).json({
        success: true,
        data: enrichedPregnancies,
        pagination: {
          page: Number.parseInt(page),
          limit: Number.parseInt(limit),
          total,
          pages: Math.ceil(total / Number.parseInt(limit)),
        },
      });
    } catch (error) {
      console.error("Get assigned women error:", error);
      logger.error("Get assigned women error:", error);
      res.status(500).json({
        error: "Failed to get assigned women",
        details: error.message,
      });
    }
  }

  /**
   * Get single woman details with full history
   */
  async getWomanDetails(req, res) {
    try {
      const { pregnancyId } = req.params;
      const chewId = req.user._id;

      const pregnancy = await Pregnancy.findOne({
        _id: pregnancyId,
        chewId,
      }).populate("womanId", "-password");

      if (!pregnancy) {
        return res.status(404).json({ error: "Pregnancy not found" });
      }

      const ancPregnancy = await ANCPregnancy.findOne({
        pregnancyId: pregnancy._id,
      });
      const dangerReports = await DangerReport.find({
        pregnancyId: pregnancy._id,
      })
        .sort({ timestamp: -1 })
        .limit(50);

      const messageHistory = await MessageQueue.find({
        "metadata.pregnancyId": pregnancy._id,
      })
        .sort({ createdAt: -1 })
        .limit(100);

      const details = {
        pregnancy: {
          id: pregnancy._id,
          status: pregnancy.status,
          gestationalWeek: pregnancy.gestationalWeek,
          lmp: pregnancy.lmp,
          edd: pregnancy.edd,
          registrationDate: pregnancy.registrationDate,
          clinicName: pregnancy.clinicName,
          parity: pregnancy.parity,
          gravida: pregnancy.gravida,
          riskFactors: pregnancy.riskFactors,
        },
        woman: {
          id: pregnancy.womanId._id,
          name: pregnancy.womanId.name,
          phone: pregnancy.womanId.phone,
          email: pregnancy.womanId.email,
          address: pregnancy.womanId.address,
          preferredLanguage: pregnancy.womanId.preferredLanguage,
          trustedContact: pregnancy.womanId.trustedContact,
          consent: pregnancy.womanId.consent,
        },
        ancSchedule:
          ancPregnancy?.fmohSchedule.map((visit) => ({
            weekNumber: visit.weekNumber,
            milestoneNumber: visit.milestoneNumber,
            description: visit.description,
            scheduledDate: visit.scheduledDate,
            attended: visit.attended,
            attendedDate: visit.attendedDate,
            reminderSent: visit.reminderSent,
            reminderDate: visit.reminderDate,
            notes: visit.notes,
          })) || [],
        dangerReports: dangerReports.map((report) => ({
          id: report._id,
          symptoms: report.reportedSymptoms,
          triageOutcome: report.triageOutcome,
          timestamp: report.timestamp,
          followupStatus: report.followup?.status,
          followupOutcome: report.followup?.outcome,
          chewAlerted: report.chewAlerted,
          trustedAlerted: report.trustedAlerted,
        })),
        messageHistory: messageHistory.map((msg) => ({
          type: msg.type,
          content: msg.content,
          status: msg.status,
          sentAt: msg.sentAt,
          deliveredAt: msg.deliveredAt,
        })),
      };

      res.status(200).json({
        success: true,
        data: details,
      });
    } catch (error) {
      logger.error("Get woman details error:", error);
      res.status(500).json({ error: "Failed to get woman details" });
    }
  }

  /**
   * Get red flag alerts
   */
  async getRedFlags(req, res) {
    try {
      const chewId = req.user._id;
      const { status = "pending", page = 1, limit = 20 } = req.query;

      const query = { chewId, triageOutcome: "RED" };
      if (status !== "all") {
        query["followup.status"] = status;
      }

      const redFlags = await DangerReport.find(query)
        .populate("womanId", "name phone preferredLanguage")
        .populate("pregnancyId", "gestationalWeek edd")
        .sort({ timestamp: -1 })
        .skip((page - 1) * Number.parseInt(limit))
        .limit(Number.parseInt(limit));

      const total = await DangerReport.countDocuments(query);

      // Calculate response time metrics
      const respondedFlags = redFlags.filter((f) => f.followup?.completedAt);
      const avgResponseTime =
        respondedFlags.length > 0
          ? respondedFlags.reduce((sum, f) => {
              const responseTime =
                (f.followup.completedAt - f.timestamp) / (1000 * 60);
              return sum + responseTime;
            }, 0) / respondedFlags.length
          : null;

      res.status(200).json({
        success: true,
        data: redFlags.map((flag) => ({
          id: flag._id,
          womanName: flag.womanId?.name,
          womanPhone: flag.womanId?.phone,
          gestationalWeek: flag.pregnancyId?.gestationalWeek,
          reportedSymptoms: flag.reportedSymptoms,
          symptomDescriptions: flag.symptomDescriptions,
          timestamp: flag.timestamp,
          followupStatus: flag.followup?.status,
          followupOutcome: flag.followup?.outcome,
          followupNotes: flag.followup?.notes,
          completedAt: flag.followup?.completedAt,
          chewAlerted: flag.chewAlerted,
          trustedAlerted: flag.trustedAlerted,
        })),
        metrics: {
          total,
          pending: await DangerReport.countDocuments({
            ...query,
            "followup.status": "pending",
          }),
          completed: await DangerReport.countDocuments({
            ...query,
            "followup.status": "completed",
          }),
          escalated: await DangerReport.countDocuments({
            ...query,
            "followup.status": "escalated",
          }),
          avgResponseTimeMinutes: avgResponseTime
            ? Math.round(avgResponseTime)
            : null,
        },
        pagination: {
          page: Number.parseInt(page),
          limit: Number.parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error("Get red flags error:", error);
      res.status(500).json({ error: "Failed to get red flags" });
    }
  }

  /**
   * Update red flag follow-up
   */
  async updateFollowUp(req, res) {
    try {
      const { reportId } = req.params;
      const { outcome, notes, escalationLevel } = req.body;
      const chewId = req.user._id;

      const report = await DangerReport.findOne({ _id: reportId, chewId });
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }

      report.followup = {
        status: outcome === "unable_to_reach" ? "escalated" : "completed",
        outcome: outcome,
        notes: notes || "",
        completedBy: chewId,
        completedAt: new Date(),
        escalationLevel: escalationLevel || 0,
      };

      await report.save();

      // Log the follow-up action
      await SystemEvent.create({
        type: "RED_FLAG_FOLLOWUP",
        severity: "MEDIUM",
        message: `CHEW followed up on RED flag ${reportId}`,
        details: {
          reportId,
          chewId,
          outcome,
          notes,
        },
      });

      logger.info(
        `RED flag ${reportId} updated by CHEW ${chewId} with outcome: ${outcome}`,
      );

      res.status(200).json({
        success: true,
        message: "Follow-up recorded successfully",
        data: report,
      });
    } catch (error) {
      logger.error("Update follow-up error:", error);
      res.status(500).json({ error: "Failed to update follow-up" });
    }
  }

  /**
   * Get CHEW performance metrics
   */
  async getPerformance(req, res) {
    try {
      const chewId = req.user._id;
      const { period = "month" } = req.query;

      let startDate;
      switch (period) {
        case "week":
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case "month":
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          break;
        case "quarter":
          startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      }

      const pregnancies = await Pregnancy.find({ chewId });
      const pregnancyIds = pregnancies.map((p) => p._id);

      // Calculate metrics
      const [
        totalRegistrations,
        totalVisits,
        completedVisits,
        totalRedFlags,
        respondedRedFlags,
        avgResponseTime,
      ] = await Promise.all([
        Pregnancy.countDocuments({
          chewId,
          registrationDate: { $gte: startDate },
        }),
        this.getTotalScheduledVisits(pregnancyIds),
        this.getCompletedVisits(pregnancyIds, startDate),
        DangerReport.countDocuments({
          chewId,
          triageOutcome: "RED",
          timestamp: { $gte: startDate },
        }),
        DangerReport.countDocuments({
          chewId,
          triageOutcome: "RED",
          "followup.status": "completed",
          timestamp: { $gte: startDate },
        }),
        this.getAverageResponseTime(chewId, startDate),
      ]);

      const ancCompletionRate =
        totalVisits > 0 ? (completedVisits / totalVisits) * 100 : 0;
      const redFlagResponseRate =
        totalRedFlags > 0 ? (respondedRedFlags / totalRedFlags) * 100 : 0;

      res.status(200).json({
        success: true,
        period,
        metrics: {
          registrations: totalRegistrations,
          ancCompletionRate: Math.round(ancCompletionRate),
          redFlagResponseRate: Math.round(redFlagResponseRate),
          totalRedFlags,
          respondedRedFlags,
          averageResponseTimeMinutes: avgResponseTime
            ? Math.round(avgResponseTime)
            : null,
          totalVisitsCompleted: completedVisits,
          activeWomen: pregnancies.filter((p) => p.status === "active").length,
        },
      });
    } catch (error) {
      logger.error("Get performance error:", error);
      res.status(500).json({ error: "Failed to get performance metrics" });
    }
  }

  // Helper methods
  async getUpcomingVisits(chewId, daysAhead = 7) {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + daysAhead);

    const pregnancies = await Pregnancy.find({
      chewId,
      status: "active",
    }).populate("womanId");

    const upcoming = [];
    for (const pregnancy of pregnancies) {
      const ancPregnancy = await ANCPregnancy.findOne({
        pregnancyId: pregnancy._id,
      });
      const nextVisit = ancPregnancy?.fmohSchedule.find(
        (v) => !v.attended && v.scheduledDate <= endDate,
      );

      if (nextVisit) {
        upcoming.push({ pregnancy, visit: nextVisit });
      }
    }

    return upcoming;
  }

  async getTotalScheduledVisits(pregnancyIds) {
    let total = 0;
    for (const id of pregnancyIds) {
      const anc = await ANCPregnancy.findOne({ pregnancyId: id });
      total += anc?.fmohSchedule.length || 0;
    }
    return total;
  }

  async getCompletedVisits(pregnancyIds, startDate) {
    let completed = 0;
    for (const id of pregnancyIds) {
      const anc = await ANCPregnancy.findOne({ pregnancyId: id });
      if (anc) {
        completed += anc.fmohSchedule.filter(
          (v) => v.attended && v.attendedDate >= startDate,
        ).length;
      }
    }
    return completed;
  }

  async getAverageResponseTime(chewId, startDate) {
    const reports = await DangerReport.find({
      chewId,
      triageOutcome: "RED",
      "followup.completedAt": { $exists: true },
      timestamp: { $gte: startDate },
    });

    if (reports.length === 0) return null;

    const totalResponseTime = reports.reduce((sum, report) => {
      const responseTime =
        (report.followup.completedAt - report.timestamp) / (1000 * 60);
      return sum + responseTime;
    }, 0);

    return totalResponseTime / reports.length;
  }

  async calculateResponseRate(chewId) {
    const totalRedFlags = await DangerReport.countDocuments({
      chewId,
      triageOutcome: "RED",
    });
    const responded = await DangerReport.countDocuments({
      chewId,
      triageOutcome: "RED",
      "followup.status": "completed",
    });

    return totalRedFlags > 0 ? (responded / totalRedFlags) * 100 : 100;
  }

  generateRegistrationCode() {
    return "CHW" + Math.random().toString(36).substring(2, 8).toUpperCase();
  }
}

export default new CHEWController();
