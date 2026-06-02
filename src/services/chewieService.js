import CHEWProfile from "../models/CHEWProfile.js";
import User from "../models/User.js";
import Pregnancy from "../models/Pregnancy.js";
import ANCPregnancy from "../models/ANCPregnancy.js";
import DangerReport from "../models/DangerReport.js";
import MessageQueue from "../models/MessageQueue.js";
import MessagingService from "./messagingService.js";
import logger from "../utils/logger.js";
import crypto from "node:crypto";
import mongoose from "mongoose";

class CHEWService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 300000; // 5 minutes
  }

  /**
   * Create a new CHEW profile
   */
  async createCHEWProfile(data) {
    const session = await mongoose.startSession();
    session.startTransaction();

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
        settings,
      } = data;

      // Check if CHEW already exists
      const existing = await CHEWProfile.findOne({
        $or: [{ userId }, { registrationCode }],
      });

      if (existing) {
        throw new Error("CHEW profile already exists");
      }

      // Get user and update role
      const user = await User.findById(userId);
      if (!user) {
        throw new Error("User not found");
      }

      user.role = "chew";
      await user.save({ session });

      // Generate registration code if not provided
      const finalRegCode = registrationCode || this.generateRegistrationCode();

      // Create CHEW profile
      const chewProfile = new CHEWProfile({
        userId,
        phcId,
        phcName,
        phcAddress,
        lga,
        state,
        supervisorId,
        registrationCode: finalRegCode,
        isActive: true,
        settings: {
          smsAlerts: true,
          dailyDigest: true,
          language: user.preferredLanguage || "en",
          ...settings,
        },
        performance: {
          ancCompletionRate: 0,
          redFlagResponseRate: 0,
          averageResponseTime: null,
          lastMonthMetrics: {
            ancVisitsConducted: 0,
            redFlagsResponded: 0,
            womenRegistered: 0,
          },
        },
      });

      await chewProfile.save({ session });
      await session.commitTransaction();

      // Send welcome message to CHEW
      await this.sendCHEWWelcome(chewProfile, user);

      logger.info(
        `CHEW profile created for user: ${userId} at PHC: ${phcName}`,
      );

      return chewProfile;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Create CHEW profile error:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get CHEW profile by user ID
   */
  async getCHEWProfile(userId) {
    try {
      // Check cache first
      const cacheKey = `chew_profile_${userId}`;
      const cached = this.getFromCache(cacheKey);
      if (cached) return cached;

      const chewProfile = await CHEWProfile.findOne({ userId })
        .populate("userId", "name phone email preferredLanguage")
        .populate("supervisorId", "name phone");

      if (!chewProfile) {
        return null;
      }

      // Get additional stats
      const stats = await this.getCHEWStatistics(chewProfile._id);

      const result = {
        ...chewProfile.toObject(),
        statistics: stats,
      };

      // Cache the result
      this.setInCache(cacheKey, result);

      return result;
    } catch (error) {
      logger.error("Get CHEW profile error:", error);
      throw error;
    }
  }

  /**
   * Get CHEW by registration code
   */
  async getCHEWByRegistrationCode(registrationCode) {
    try {
      const chewProfile = await CHEWProfile.findOne({
        registrationCode,
      }).populate("userId", "name phone email");

      return chewProfile;
    } catch (error) {
      logger.error("Get CHEW by registration code error:", error);
      throw error;
    }
  }

  /**
   * Update CHEW profile
   */
  async updateCHEWProfile(userId, updates) {
    try {
      const allowedUpdates = [
        "phcName",
        "phcAddress",
        "lga",
        "state",
        "supervisorId",
        "settings",
      ];

      const filteredUpdates = {};
      for (const key of allowedUpdates) {
        if (updates[key] !== undefined) {
          filteredUpdates[key] = updates[key];
        }
      }

      const chewProfile = await CHEWProfile.findOneAndUpdate(
        { userId },
        { $set: filteredUpdates },
        { new: true, runValidators: true },
      ).populate("userId", "name phone");

      if (!chewProfile) {
        throw new Error("CHEW profile not found");
      }

      // Invalidate cache
      this.invalidateCache(`chew_profile_${userId}`);

      logger.info(`CHEW profile updated for user: ${userId}`);

      return chewProfile;
    } catch (error) {
      logger.error("Update CHEW profile error:", error);
      throw error;
    }
  }

  /**
   * Deactivate CHEW profile
   */
  async deactivateCHEW(userId, reason) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const chewProfile = await CHEWProfile.findOneAndUpdate(
        { userId },
        {
          $set: {
            isActive: false,
            deactivatedAt: new Date(),
            deactivationReason: reason,
          },
        },
        { new: true },
      );

      if (!chewProfile) {
        throw new Error("CHEW profile not found");
      }

      // Reassign all pregnancies to supervisor or admin
      await this.reassignPregnancies(chewProfile._id, chewProfile.supervisorId);

      // Update user role back to patient
      await User.findByIdAndUpdate(userId, { role: "patient" });

      await session.commitTransaction();

      // Invalidate cache
      this.invalidateCache(`chew_profile_${userId}`);

      logger.info(
        `CHEW profile deactivated for user: ${userId}, reason: ${reason}`,
      );

      return chewProfile;
    } catch (error) {
      await session.abortTransaction();
      logger.error("Deactivate CHEW error:", error);
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Get CHEW dashboard data with real-time metrics
   */
  async getCHEWDashboard(chewId) {
    try {
      const chewProfile = await CHEWProfile.findOne({ userId: chewId });
      if (!chewProfile) {
        throw new Error("CHEW profile not found");
      }

      // Get all pregnancies for this CHEW
      const pregnancies = await Pregnancy.find({ chewId }).populate(
        "womanId",
        "name phone preferredLanguage",
      );

      const pregnancyIds = pregnancies.map((p) => p._id);

      // Parallel queries for efficiency
      const [ancRecords, redFlags, recentMessages, weeklyStats] =
        await Promise.all([
          ANCPregnancy.find({ pregnancyId: { $in: pregnancyIds } }),
          DangerReport.find({
            pregnancyId: { $in: pregnancyIds },
            timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          }).sort({ timestamp: -1 }),
          MessageQueue.find({
            "metadata.pregnancyId": { $in: pregnancyIds },
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
          })
            .sort({ createdAt: -1 })
            .limit(50),
          this.getWeeklyStatistics(chewId),
        ]);

      // Calculate metrics
      const metrics = this.calculateCHEWMetrics(
        pregnancies,
        ancRecords,
        redFlags,
      );

      // Get upcoming visits
      const upcomingVisits = await this.getUpcomingVisits(chewId, 7);

      // Get recent red flags
      const recentRedFlags = redFlags.slice(0, 10).map((flag) => ({
        id: flag._id,
        womanName: flag.womanId?.name,
        symptoms: flag.reportedSymptoms,
        timestamp: flag.timestamp,
        status: flag.followup?.status,
      }));

      // Update CHEW performance metrics
      await this.updateCHEWPerformance(chewProfile, metrics);

      const dashboard = {
        profile: {
          id: chewProfile._id,
          phcName: chewProfile.phcName,
          phcId: chewProfile.phcId,
          lga: chewProfile.lga,
          state: chewProfile.state,
          assignedWomenCount: pregnancies.length,
        },
        metrics: {
          totalWomen: pregnancies.length,
          activePregnancies: pregnancies.filter((p) => p.status === "active")
            .length,
          highRiskWomen: pregnancies.filter((p) => p.riskFactors?.length > 0)
            .length,
          ancCompletionRate: metrics.ancCompletionRate,
          redFlagResponseRate: metrics.redFlagResponseRate,
          averageResponseTime: metrics.avgResponseTime,
          totalRedFlags: redFlags.length,
          pendingRedFlags: redFlags.filter(
            (r) => r.followup?.status === "pending",
          ).length,
        },
        upcomingVisits: upcomingVisits.map((visit) => ({
          womanName: visit.pregnancy.womanId?.name,
          womanPhone: visit.pregnancy.womanId?.phone,
          weekNumber: visit.visit.weekNumber,
          milestoneNumber: visit.visit.milestoneNumber,
          scheduledDate: visit.visit.scheduledDate,
          daysUntil: visit.daysUntil,
        })),
        recentAlerts: recentRedFlags,
        recentMessages: recentMessages.map((msg) => ({
          type: msg.type,
          status: msg.status,
          to: msg.to,
          createdAt: msg.createdAt,
        })),
        weeklyStats,
      };

      return dashboard;
    } catch (error) {
      logger.error("Get CHEW dashboard error:", error);
      throw error;
    }
  }

  /**
   * Get all women assigned to a CHEW with filters
   */
  async getAssignedWomen(chewId, filters = {}) {
    try {
      const {
        status = "all",
        riskLevel = "all",
        search = "",
        page = 1,
        limit = 20,
        sortBy = "registrationDate",
        sortOrder = "desc",
      } = filters;

      const query = { chewId };

      if (status !== "all") {
        query.status = status;
      }

      if (riskLevel === "high") {
        query.riskFactors = { $exists: true, $ne: [] };
      }

      // Search by woman name or phone
      if (search) {
        const women = await User.find({
          $or: [
            { name: { $regex: search, $options: "i" } },
            { phone: { $regex: search, $options: "i" } },
          ],
        }).select("_id");

        query.womanId = { $in: women.map((w) => w._id) };
      }

      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

      const pregnancies = await Pregnancy.find(query)
        .populate(
          "womanId",
          "name phone preferredLanguage address trustedContact",
        )
        .sort(sortOptions)
        .skip((page - 1) * limit)
        .limit(Number.parseInt(limit));

      const total = await Pregnancy.countDocuments(query);

      // Enrich with additional data
      const enrichedData = await Promise.all(
        pregnancies.map(async (pregnancy) => {
          const ancPregnancy = await ANCPregnancy.findOne({
            pregnancyId: pregnancy._id,
          });
          const lastRedFlag = await DangerReport.findOne({
            pregnancyId: pregnancy._id,
            triageOutcome: "RED",
          }).sort({ timestamp: -1 });

          const nextVisit = ancPregnancy?.fmohSchedule.find((v) => !v.attended);

          return {
            id: pregnancy._id,
            woman: {
              id: pregnancy.womanId._id,
              name: pregnancy.womanId.name,
              phone: pregnancy.womanId.phone,
              preferredLanguage: pregnancy.womanId.preferredLanguage,
              trustedContact: pregnancy.womanId.trustedContact,
            },
            clinical: {
              gestationalWeek: pregnancy.gestationalWeek,
              edd: pregnancy.edd,
              parity: pregnancy.parity,
              riskFactors: pregnancy.riskFactors,
              status: pregnancy.status,
            },
            anc: {
              completedVisits:
                ancPregnancy?.fmohSchedule.filter((v) => v.attended).length ||
                0,
              totalVisits: ancPregnancy?.fmohSchedule.length || 8,
              nextVisit: nextVisit
                ? {
                    weekNumber: nextVisit.weekNumber,
                    milestoneNumber: nextVisit.milestoneNumber,
                    scheduledDate: nextVisit.scheduledDate,
                    daysUntil: Math.ceil(
                      (nextVisit.scheduledDate - Date.now()) /
                        (1000 * 60 * 60 * 24),
                    ),
                  }
                : null,
              lastAttendance: ancPregnancy?.fmohSchedule
                .filter((v) => v.attended)
                .sort((a, b) => b.attendedDate - a.attendedDate)[0]
                ?.attendedDate,
            },
            alerts: {
              hasActiveRedFlag:
                lastRedFlag && lastRedFlag.followup?.status === "pending",
              lastRedFlagDate: lastRedFlag?.timestamp,
              redFlagStatus: lastRedFlag?.followup?.status,
            },
            registrationDate: pregnancy.registrationDate,
          };
        }),
      );

      return {
        data: enrichedData,
        pagination: {
          page: Number.parseInt(page),
          limit: Number.parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Get assigned women error:", error);
      throw error;
    }
  }

  /**
   * Get all CHEWs in a region (for supervisors)
   */
  async getCHEWsByRegion(lga, state) {
    try {
      const query = {};
      if (lga) query.lga = lga;
      if (state) query.state = state;
      query.isActive = true;

      const chews = await CHEWProfile.find(query)
        .populate("userId", "name phone email")
        .populate("supervisorId", "name phone")
        .sort({ createdAt: -1 });

      // Get performance metrics for each CHEW
      const enrichedChews = await Promise.all(
        chews.map(async (chew) => {
          const stats = await this.getCHEWStatistics(chew._id);
          return {
            ...chew.toObject(),
            statistics: stats,
          };
        }),
      );

      return enrichedChews;
    } catch (error) {
      logger.error("Get CHEWs by region error:", error);
      throw error;
    }
  }

  /**
   * Get CHEW performance metrics
   */
  async getCHEWPerformance(chewId, period = "month") {
    try {
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

      // Get period-specific data
      const [
        registrations,
        ancRecords,
        redFlags,
        respondedRedFlags,
        responseTimes,
      ] = await Promise.all([
        Pregnancy.countDocuments({
          chewId,
          registrationDate: { $gte: startDate },
        }),
        ANCPregnancy.find({ pregnancyId: { $in: pregnancyIds } }),
        DangerReport.find({
          chewId,
          timestamp: { $gte: startDate },
          triageOutcome: "RED",
        }),
        DangerReport.find({
          chewId,
          timestamp: { $gte: startDate },
          triageOutcome: "RED",
          "followup.status": "completed",
        }),
        DangerReport.find({
          chewId,
          "followup.completedAt": { $exists: true },
          timestamp: { $gte: startDate },
        }),
      ]);

      // Calculate metrics
      let totalVisits = 0;
      let completedVisits = 0;

      for (const anc of ancRecords) {
        totalVisits += anc.fmohSchedule.length;
        completedVisits += anc.fmohSchedule.filter(
          (v) => v.attended && v.attendedDate >= startDate,
        ).length;
      }

      const ancCompletionRate =
        totalVisits > 0 ? (completedVisits / totalVisits) * 100 : 0;
      const redFlagResponseRate =
        redFlags.length > 0
          ? (respondedRedFlags.length / redFlags.length) * 100
          : 100;

      const avgResponseTime =
        responseTimes.length > 0
          ? responseTimes.reduce((sum, r) => {
              const time = (r.followup.completedAt - r.timestamp) / (1000 * 60);
              return sum + time;
            }, 0) / responseTimes.length
          : null;

      // Get daily trend data
      const dailyTrend = await this.getDailyTrend(chewId, startDate);

      // Get ranking
      const ranking = await this.getCHEWRanking(chewId);

      return {
        period,
        startDate,
        metrics: {
          registrations,
          ancCompletionRate: Math.round(ancCompletionRate),
          redFlagResponseRate: Math.round(redFlagResponseRate),
          totalRedFlags: redFlags.length,
          respondedRedFlags: respondedRedFlags.length,
          averageResponseTimeMinutes: avgResponseTime
            ? Math.round(avgResponseTime)
            : null,
          totalVisitsCompleted: completedVisits,
          activeWomen: pregnancies.filter((p) => p.status === "active").length,
        },
        dailyTrend,
        ranking,
      };
    } catch (error) {
      logger.error("Get CHEW performance error:", error);
      throw error;
    }
  }

  /**
   * Send message to all women assigned to a CHEW
   */
  async broadcastToWomen(chewId, message, options = {}) {
    try {
      const pregnancies = await Pregnancy.find({
        chewId,
        status: "active",
      }).populate("womanId");

      const results = {
        total: pregnancies.length,
        sent: 0,
        failed: 0,
        errors: [],
      };

      for (const pregnancy of pregnancies) {
        try {
          await MessagingService.queueMessage({
            to: pregnancy.womanId.phone,
            content: message,
            language: pregnancy.womanId.preferredLanguage || "en",
            type: "broadcast",
            priority: options.priority || "normal",
            metadata: {
              chewId,
              broadcastId: options.broadcastId,
              pregnancyId: pregnancy._id,
            },
          });
          results.sent++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            pregnancyId: pregnancy._id,
            error: error.message,
          });
        }
      }

      logger.info(
        `Broadcast sent by CHEW ${chewId}: ${results.sent}/${results.total} delivered`,
      );

      return results;
    } catch (error) {
      logger.error("Broadcast to women error:", error);
      throw error;
    }
  }

  /**
   * Get CHEW statistics for reporting
   */
  async getCHEWStatistics(chewId) {
    try {
      const pregnancies = await Pregnancy.find({ chewId });
      const pregnancyIds = pregnancies.map((p) => p._id);

      // Calculate synchronous values separately
      const totalWomen = pregnancies.length;
      const activeWomen = pregnancies.filter(
        (p) => p.status === "active",
      ).length;
      const highRiskWomen = pregnancies.filter(
        (p) => p.riskFactors?.length > 0,
      ).length;

      // Run only async operations in Promise.all
      const [ancRecords, redFlags, completedFollowups, messagesSent] =
        await Promise.all([
          ANCPregnancy.find({ pregnancyId: { $in: pregnancyIds } }),
          DangerReport.countDocuments({ chewId, triageOutcome: "RED" }),
          DangerReport.countDocuments({
            chewId,
            triageOutcome: "RED",
            "followup.status": "completed",
          }),
          MessageQueue.countDocuments({ "metadata.chewId": chewId }),
        ]);

      let totalVisits = 0;
      let completedVisits = 0;

      for (const anc of ancRecords) {
        totalVisits += anc.fmohSchedule.length;
        completedVisits += anc.fmohSchedule.filter((v) => v.attended).length;
      }

      const ancCompletionRate =
        totalVisits > 0 ? (completedVisits / totalVisits) * 100 : 0;
      const redFlagResponseRate =
        redFlags > 0 ? (completedFollowups / redFlags) * 100 : 100;

      return {
        totalWomen,
        activeWomen,
        highRiskWomen,
        ancCompletionRate: Math.round(ancCompletionRate),
        redFlagResponseRate: Math.round(redFlagResponseRate),
        totalRedFlags: redFlags,
        completedFollowups,
        messagesSent,
        totalVisitsCompleted: completedVisits,
      };
    } catch (error) {
      logger.error("Get CHEW statistics error:", error);
      throw error;
    }
  }

  /**
   * Helper: Calculate CHEW metrics
   */
  calculateCHEWMetrics(pregnancies, ancRecords, redFlags) {
    let totalVisits = 0;
    let completedVisits = 0;

    for (const anc of ancRecords) {
      totalVisits += anc.fmohSchedule.length;
      completedVisits += anc.fmohSchedule.filter((v) => v.attended).length;
    }

    const ancCompletionRate =
      totalVisits > 0 ? (completedVisits / totalVisits) * 100 : 0;

    const totalRedFlags = redFlags.length;
    const respondedRedFlags = redFlags.filter(
      (r) => r.followup?.status === "completed",
    ).length;
    const redFlagResponseRate =
      totalRedFlags > 0 ? (respondedRedFlags / totalRedFlags) * 100 : 100;

    const avgResponseTime =
      redFlags
        .filter((r) => r.followup?.completedAt)
        .reduce(
          (sum, r) =>
            sum + (r.followup.completedAt - r.timestamp) / (1000 * 60),
          0,
        ) / (redFlags.filter((r) => r.followup?.completedAt).length || 1);

    return {
      ancCompletionRate: Math.round(ancCompletionRate),
      redFlagResponseRate: Math.round(redFlagResponseRate),
      avgResponseTime: Math.round(avgResponseTime),
    };
  }

  /**
   * Helper: Update CHEW performance metrics
   */
  async updateCHEWPerformance(chewProfile, metrics) {
    chewProfile.performance.ancCompletionRate = metrics.ancCompletionRate;
    chewProfile.performance.redFlagResponseRate = metrics.redFlagResponseRate;
    chewProfile.performance.averageResponseTime = metrics.avgResponseTime;
    await chewProfile.save();
  }

  /**
   * Helper: Get upcoming visits
   */
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
        upcoming.push({
          pregnancy,
          visit: nextVisit,
          daysUntil: Math.ceil(
            (nextVisit.scheduledDate - Date.now()) / (1000 * 60 * 60 * 24),
          ),
        });
      }
    }

    return upcoming.sort((a, b) => a.daysUntil - b.daysUntil);
  }

  /**
   * Helper: Get weekly statistics
   */
  async getWeeklyStatistics(chewId) {
    const weeks = [];
    for (let i = 4; i >= 0; i--) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - i * 7);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + 7);

      const registrations = await Pregnancy.countDocuments({
        chewId,
        registrationDate: { $gte: startDate, $lt: endDate },
      });

      const redFlags = await DangerReport.countDocuments({
        chewId,
        timestamp: { $gte: startDate, $lt: endDate },
        triageOutcome: "RED",
      });

      const visitsCompleted = await this.getVisitsCompletedInPeriod(
        chewId,
        startDate,
        endDate,
      );

      weeks.push({
        week: i === 0 ? "This Week" : `${i} weeks ago`,
        registrations,
        redFlags,
        visitsCompleted,
      });
    }
    return weeks;
  }

  /**
   * Helper: Get visits completed in a period
   */
  async getVisitsCompletedInPeriod(chewId, startDate, endDate) {
    const pregnancies = await Pregnancy.find({ chewId });
    let completed = 0;

    for (const pregnancy of pregnancies) {
      const anc = await ANCPregnancy.findOne({ pregnancyId: pregnancy._id });
      if (anc) {
        completed += anc.fmohSchedule.filter(
          (v) =>
            v.attended &&
            v.attendedDate >= startDate &&
            v.attendedDate < endDate,
        ).length;
      }
    }

    return completed;
  }

  /**
   * Helper: Get daily trend
   */
  async getDailyTrend(chewId, startDate) {
    const days = [];
    const daysToShow = 14;

    // Use the provided startDate or default to today
    const baseDate = startDate ? new Date(startDate) : new Date();

    for (let i = daysToShow; i >= 0; i--) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const registrations = await Pregnancy.countDocuments({
        chewId,
        registrationDate: { $gte: date, $lt: nextDate },
      });

      const redFlags = await DangerReport.countDocuments({
        chewId,
        timestamp: { $gte: date, $lt: nextDate },
        triageOutcome: "RED",
      });

      days.push({
        date: date.toISOString().split("T")[0],
        registrations,
        redFlags,
      });
    }

    return days;
  }

  /**
   * Helper: Get CHEW ranking
   */
  async getCHEWRanking(chewId) {
    const allCHEWs = await CHEWProfile.find({ isActive: true });
    const performances = await Promise.all(
      allCHEWs.map(async (chew) => {
        const stats = await this.getCHEWStatistics(chew._id);
        return {
          chewId: chew._id,
          ancCompletionRate: stats.ancCompletionRate,
          redFlagResponseRate: stats.redFlagResponseRate,
        };
      }),
    );

    const sortedByANC = [...performances].sort(
      (a, b) => b.ancCompletionRate - a.ancCompletionRate,
    );
    const currentCHEW = performances.find(
      (p) => p.chewId.toString() === chewId.toString(),
    );

    const ancRank =
      sortedByANC.findIndex((p) => p.chewId.toString() === chewId.toString()) +
      1;
    const percentile = (ancRank / performances.length) * 100;

    return {
      ancRank,
      totalCHEWs: performances.length,
      percentile: Math.round(percentile),
      ancCompletionRate: currentCHEW?.ancCompletionRate || 0,
      redFlagResponseRate: currentCHEW?.redFlagResponseRate || 0,
    };
  }

  /**
   * Helper: Reassign pregnancies when CHEW is deactivated
   */
  async reassignPregnancies(chewProfileId, newChewId) {
    if (!newChewId) return;

    await Pregnancy.updateMany(
      { chewId: chewProfileId },
      { $set: { chewId: newChewId } },
    );
  }

  /**
   * Helper: Send welcome message to CHEW
   */
  async sendCHEWWelcome(chewProfile, user) {
    const message = `Welcome to MamaCheck, ${user.name}! You are now registered as a Community Health Worker at ${chewProfile.phcName}. 
    
Your registration code is: ${chewProfile.registrationCode}

Login to your dashboard at: ${process.env.FRONTEND_URL}/dashboard/chew

You will receive alerts when women in your care report danger signs.`;

    await MessagingService.queueMessage({
      to: user.phone,
      content: message,
      language: user.preferredLanguage || "en",
      type: "welcome",
      priority: "high",
      metadata: {
        type: "chew_welcome",
        registrationCode: chewProfile.registrationCode,
      },
    });
  }

  /**
   * Helper: Generate registration code
   */
  generateRegistrationCode() {
    const prefix = "CHW";
    const random = crypto.randomBytes(4).toString("hex").toUpperCase();
    return `${prefix}${random}`;
  }

  /**
   * Helper: Cache management
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  setInCache(key, data, ttl = this.cacheTimeout) {
    this.cache.set(key, {
      data,
      expiresAt: Date.now() + ttl,
    });
  }

  invalidateCache(key) {
    this.cache.delete(key);
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (value.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}

export default new CHEWService();
