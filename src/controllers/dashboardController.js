import Pregnancy from "../models/Pregnancy.js";
import CHEWProfile from "../models/CHEWProfile.js";
import DangerReport from "../models/DangerReport.js";
import User from "../models/User.js";
import SystemEvent from "../models/SystemEvent.js";
import logger from "../utils/logger.js";
import ANCPregnancy from "../models/ANCPregnancy.js";

class DashboardController {
  /**
   * Get CHEW overview dashboard
   */
  async getCHEWOverview(req, res) {
    try {
      const chewId = req.user._id;
      const chewProfile = await CHEWProfile.findOne({ userId: chewId });

      if (!chewProfile) {
        return res.status(404).json({ error: "CHEW profile not found" });
      }

      // Get real-time statistics
      const [
        totalWomen,
        activePregnancies,
        highRiskWomen,
        dueThisWeek,
        overdueVisits,
        redFlagsToday,
        redFlagsThisWeek,
        avgResponseTime,
      ] = await Promise.all([
        Pregnancy.countDocuments({ chewId }),
        Pregnancy.countDocuments({ chewId, status: "active" }),
        Pregnancy.countDocuments({
          chewId,
          riskFactors: { $exists: true, $ne: [] },
        }),
        this.getDueVisitsCount(chewId, 7),
        this.getOverdueVisitsCount(chewId),
        DangerReport.countDocuments({
          chewId,
          triageOutcome: "RED",
          timestamp: { $gte: new Date().setHours(0, 0, 0, 0) },
        }),
        DangerReport.countDocuments({
          chewId,
          triageOutcome: "RED",
          timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        }),
        this.getCHEWAverageResponseTime(chewId),
      ]);

      // Get recent activity
      const recentAlerts = await DangerReport.find({
        chewId,
        triageOutcome: "RED",
      })
        .populate("womanId", "name phone")
        .sort({ timestamp: -1 })
        .limit(5);

      const recentRegistrations = await Pregnancy.find({ chewId })
        .populate("womanId", "name phone")
        .sort({ registrationDate: -1 })
        .limit(5);

      // Get weekly trend data
      const weeklyTrend = await this.getWeeklyTrend(chewId);

      res.status(200).json({
        success: true,
        overview: {
          kpis: {
            totalWomen,
            activePregnancies,
            highRiskWomen,
            dueThisWeek,
            overdueVisits,
            redFlagsToday,
            redFlagsThisWeek,
            avgResponseTimeMinutes: avgResponseTime
              ? Math.round(avgResponseTime)
              : null,
          },
          recentAlerts: recentAlerts.map((alert) => ({
            id: alert._id,
            womanName: alert.womanId?.name,
            symptoms: alert.reportedSymptoms,
            timestamp: alert.timestamp,
            status: alert.followup?.status,
          })),
          recentRegistrations: recentRegistrations.map((reg) => ({
            id: reg._id,
            womanName: reg.womanId?.name,
            gestationalWeek: reg.gestationalWeek,
            registrationDate: reg.registrationDate,
          })),
          weeklyTrend,
        },
      });
    } catch (error) {
      logger.error("Get CHEW overview error:", error);
      res.status(500).json({ error: "Failed to get dashboard overview" });
    }
  }

  /**
   * Get all women for CHEW with filters
   */
  async getCHEWWomen(req, res) {
    try {
      const chewId = req.user._id;
      const {
        page = 1,
        limit = 20,
        status = "all",
        riskLevel = "all",
        sortBy = "registrationDate",
        sortOrder = "desc",
      } = req.query;

      const query = { chewId };

      if (status !== "all") {
        query.status = status;
      }

      if (riskLevel === "high") {
        query.riskFactors = { $exists: true, $ne: [] };
      }

      const sortOptions = {};
      sortOptions[sortBy] = sortOrder === "desc" ? -1 : 1;

      const pregnancies = await Pregnancy.find(query)
        .populate(
          "womanId",
          "name phone preferredLanguage address trustedContact",
        )
        .sort(sortOptions)
        .skip((page - 1) * Number.parseInt(limit))
        .limit(Number.parseInt(limit));

      const total = await Pregnancy.countDocuments(query);

      // Enrich with additional data
      const enrichedData = await Promise.all(
        pregnancies.map(async (pregnancy) => {
          try {
            const ancPregnancy = await ANCPregnancy.findOne({
              pregnancyId: pregnancy._id,
            });
            const lastRedFlag = await DangerReport.findOne({
              pregnancyId: pregnancy._id,
              triageOutcome: "RED",
            }).sort({ timestamp: -1 });

            return {
              id: pregnancy._id,
              woman: {
                id: pregnancy.womanId?._id,
                name: pregnancy.womanId?.name,
                phone: pregnancy.womanId?.phone,
                preferredLanguage: pregnancy.womanId?.preferredLanguage,
                trustedContact: pregnancy.womanId?.trustedContact,
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
                  ancPregnancy?.fmohSchedule?.filter((v) => v.attended)
                    ?.length || 0,
                nextVisit: ancPregnancy?.fmohSchedule?.find((v) => !v.attended),
                lastAttendance: ancPregnancy?.fmohSchedule
                  ?.filter((v) => v.attended)
                  .sort(
                    (a, b) =>
                      new Date(b.attendedDate) - new Date(a.attendedDate),
                  )[0]?.attendedDate,
              },
              alerts: {
                hasRedFlag: !!lastRedFlag,
                lastRedFlagDate: lastRedFlag?.timestamp,
                redFlagStatus: lastRedFlag?.followup?.status,
              },
              registrationDate: pregnancy.registrationDate,
            };
          } catch (itemError) {
            logger.error(
              `Error enriching pregnancy ${pregnancy._id}:`,
              itemError,
            );
            // Return minimal data on error
            return {
              id: pregnancy._id,
              woman: {
                id: pregnancy.womanId?._id,
                name: pregnancy.womanId?.name,
                phone: pregnancy.womanId?.phone,
              },
              error: "Failed to enrich pregnancy data",
            };
          }
        }),
      );

      res.status(200).json({
        success: true,
        data: enrichedData,
        pagination: {
          page: Number.parseInt(page),
          limit: Number.parseInt(limit),
          total,
          pages: Math.ceil(total / Number.parseInt(limit)),
        },
        filters: {
          status,
          riskLevel,
          sortBy,
          sortOrder,
        },
      });
    } catch (error) {
      logger.error("Get CHEW women error:", error);
      res.status(500).json({ error: "Failed to get women list" });
    }
  }

  /**
   * Get red flags with advanced filtering
   */
  async getRedFlags(req, res) {
    try {
      const chewId = req.user._id;
      const {
        page = 1,
        limit = 20,
        status = "pending",
        severity = "RED",
        fromDate,
        toDate,
      } = req.query;

      const query = { chewId, triageOutcome: severity };

      if (status !== "all") {
        query["followup.status"] = status;
      }

      if (fromDate || toDate) {
        query.timestamp = {};
        if (fromDate) query.timestamp.$gte = new Date(fromDate);
        if (toDate) query.timestamp.$lte = new Date(toDate);
      }

      const redFlags = await DangerReport.find(query)
        .populate("womanId", "name phone preferredLanguage")
        .populate("pregnancyId", "gestationalWeek edd clinicName")
        .sort({ timestamp: -1 })
        .skip((page - 1) * Number.parseInt(limit))
        .limit(Number.parseInt(limit));

      const total = await DangerReport.countDocuments(query);

      // Calculate statistics
      const stats = {
        total,
        pending: await DangerReport.countDocuments({
          ...query,
          "followup.status": "pending",
        }),
        inProgress: await DangerReport.countDocuments({
          ...query,
          "followup.status": "in_progress",
        }),
        completed: await DangerReport.countDocuments({
          ...query,
          "followup.status": "completed",
        }),
        escalated: await DangerReport.countDocuments({
          ...query,
          "followup.status": "escalated",
        }),
      };

      res.status(200).json({
        success: true,
        data: redFlags.map((flag) => ({
          id: flag._id,
          woman: {
            id: flag.womanId?._id,
            name: flag.womanId?.name,
            phone: flag.womanId?.phone,
          },
          pregnancy: {
            gestationalWeek: flag.pregnancyId?.gestationalWeek,
            clinic: flag.pregnancyId?.clinicName,
          },
          report: {
            symptoms: flag.reportedSymptoms,
            timestamp: flag.timestamp,
            triageOutcome: flag.triageOutcome,
            source: flag.source,
          },
          followup: {
            status: flag.followup?.status,
            outcome: flag.followup?.outcome,
            notes: flag.followup?.notes,
            completedAt: flag.followup?.completedAt,
          },
          alerts: {
            chewAlerted: flag.chewAlerted,
            trustedAlerted: flag.trustedAlerted,
            alertTime: flag.chewAlertTime,
          },
        })),
        stats,
        pagination: {
          page: Number.parseInt(page),
          limit: Number.parseInt(limit),
          total,
          pages: Math.ceil(total / Number.parseInt(limit)),
        },
      });
    } catch (error) {
      logger.error("Get red flags error:", error);
      res.status(500).json({ error: "Failed to get red flags" });
    }
  }

  /**
   * Update red flag follow-up (dashboard version)
   */
  async updateFollowup(req, res) {
    try {
      const { reportId } = req.params;
      const { outcome, notes, escalationLevel } = req.body;
      const chewId = req.user._id;

      const report = await DangerReport.findOne({ _id: reportId, chewId });
      if (!report) {
        return res.status(404).json({ error: "Report not found" });
      }

      const previousStatus = report.followup?.status;

      report.followup = {
        status: outcome === "unable_to_reach" ? "escalated" : "completed",
        outcome: outcome,
        notes: notes || "",
        completedBy: chewId,
        completedAt: new Date(),
        escalationLevel:
          escalationLevel || (previousStatus === "escalated" ? 1 : 0),
      };

      await report.save();

      // Log audit trail
      await SystemEvent.create({
        type: "FOLLOWUP_UPDATED",
        severity: "LOW",
        message: `Follow-up updated for RED flag ${reportId}`,
        details: {
          reportId,
          chewId,
          previousStatus,
          newStatus: report.followup.status,
          outcome,
          notes,
        },
      });

      res.status(200).json({
        success: true,
        message: "Follow-up updated successfully",
        data: {
          id: report._id,
          status: report.followup.status,
          outcome: report.followup.outcome,
          completedAt: report.followup.completedAt,
        },
      });
    } catch (error) {
      logger.error("Update followup error:", error);
      res.status(500).json({ error: "Failed to update follow-up" });
    }
  }

  /**
   * Get weekly summary for CHEW
   */
  async getWeeklySummary(req, res) {
    try {
      const chewId = req.user._id;
      const startOfWeek = new Date();
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(endOfWeek.getDate() + 7);

      // Get daily stats for the week
      const dailyStats = [];
      for (let i = 0; i < 7; i++) {
        const day = new Date(startOfWeek);
        day.setDate(day.getDate() + i);
        const nextDay = new Date(day);
        nextDay.setDate(nextDay.getDate() + 1);

        const registrations = await Pregnancy.countDocuments({
          chewId,
          registrationDate: { $gte: day, $lt: nextDay },
        });

        const redFlags = await DangerReport.countDocuments({
          chewId,
          timestamp: { $gte: day, $lt: nextDay },
          triageOutcome: "RED",
        });

        const visits = await this.getVisitsForDay(chewId, day);

        dailyStats.push({
          date: day,
          dayName: day.toLocaleDateString("en-US", { weekday: "short" }),
          registrations,
          redFlags,
          visitsCompleted: visits.completed,
          visitsScheduled: visits.scheduled,
        });
      }

      // Get top symptoms this week
      const symptomStats = await DangerReport.aggregate([
        { $match: { chewId, timestamp: { $gte: startOfWeek } } },
        { $unwind: "$reportedSymptoms" },
        { $group: { _id: "$reportedSymptoms", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
      ]);

      res.status(200).json({
        success: true,
        week: {
          startDate: startOfWeek,
          endDate: endOfWeek,
          weekNumber: this.getWeekNumber(startOfWeek),
        },
        dailyStats,
        topSymptoms: symptomStats.map((s) => ({
          symptomCode: s._id,
          symptomName: this.getSymptomName(s._id),
          count: s.count,
        })),
        summary: {
          totalRegistrations: dailyStats.reduce(
            (sum, d) => sum + d.registrations,
            0,
          ),
          totalRedFlags: dailyStats.reduce((sum, d) => sum + d.redFlags, 0),
          totalVisitsCompleted: dailyStats.reduce(
            (sum, d) => sum + d.visitsCompleted,
            0,
          ),
          avgDailyRegistrations:
            dailyStats.reduce((sum, d) => sum + d.registrations, 0) / 7,
        },
      });
    } catch (error) {
      logger.error("Get weekly summary error:", error);
      res.status(500).json({ error: "Failed to get weekly summary" });
    }
  }

  /**
   * Get LGA summary for supervisors
   */
  async getLGASummary(req, res) {
    try {
      const { lga, state } = req.query;

      const query = {};
      if (lga) query.lga = lga;
      if (state) query.state = state;

      const chews = await CHEWProfile.find(query);
      const chewIds = chews.map((c) => c.userId);

      // Aggregate statistics across all CHEWs in LGA
      const pregnancies = await Pregnancy.find({ chewId: { $in: chewIds } });
      const redFlags = await DangerReport.find({ chewId: { $in: chewIds } });

      const totalWomen = pregnancies.length;
      const activeWomen = pregnancies.filter(
        (p) => p.status === "active",
      ).length;
      const totalRedFlags = redFlags.length;
      const respondedRedFlags = redFlags.filter(
        (r) => r.followup?.status === "completed",
      ).length;

      // CHEW performance rankings
      const chewPerformance = await Promise.all(
        chews.map(async (chew) => {
          const chewPregnancies = pregnancies.filter(
            (p) => p.chewId.toString() === chew.userId.toString(),
          );
          const chewRedFlags = redFlags.filter(
            (r) => r.chewId.toString() === chew.userId.toString(),
          );

          const ancCompletionRate = await this.getCHEWANCCompletionRate(
            chew.userId,
          );

          return {
            chewId: chew.userId,
            name: (await User.findById(chew.userId))?.name,
            phcName: chew.phcName,
            totalWomen: chewPregnancies.length,
            activeWomen: chewPregnancies.filter((p) => p.status === "active")
              .length,
            redFlagsReceived: chewRedFlags.length,
            redFlagsResponded: chewRedFlags.filter(
              (r) => r.followup?.status === "completed",
            ).length,
            ancCompletionRate: Math.round(ancCompletionRate),
            responseRate:
              chewRedFlags.length > 0
                ? Math.round(
                    (chewRedFlags.filter(
                      (r) => r.followup?.status === "completed",
                    ).length /
                      chewRedFlags.length) *
                      100,
                  )
                : 100,
          };
        }),
      );

      res.status(200).json({
        success: true,
        region: { lga, state },
        summary: {
          totalCHEWs: chews.length,
          totalWomen,
          activeWomen,
          totalRedFlags,
          redFlagResponseRate:
            totalRedFlags > 0 ? (respondedRedFlags / totalRedFlags) * 100 : 100,
          averageANCCompletion:
            chewPerformance.reduce((sum, c) => sum + c.ancCompletionRate, 0) /
            chews.length,
        },
        chewPerformance: chewPerformance.toSorted(
          (a, b) => b.ancCompletionRate - a.ancCompletionRate,
        ),
      });
    } catch (error) {
      logger.error("Get LGA summary error:", error);
      res.status(500).json({ error: "Failed to get LGA summary" });
    }
  }

  /**
   * Get CHEW performance for supervisors
   */
  async getCHEWPerformance(req, res) {
    try {
      const { chewId, period = "month" } = req.query;

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

      const chew = await CHEWProfile.findOne({ userId: chewId });
      if (!chew) {
        return res.status(404).json({ error: "CHEW not found" });
      }

      const user = await User.findById(chewId);
      const pregnancies = await Pregnancy.find({
        chewId,
        registrationDate: { $gte: startDate },
      });
      const redFlags = await DangerReport.find({
        chewId,
        timestamp: { $gte: startDate },
      });

      // Calculate daily trend data
      const dailyTrend = await this.getDailyTrend(chewId, startDate);

      res.status(200).json({
        success: true,
        chew: {
          id: chew.userId,
          name: user?.name,
          phcName: chew.phcName,
          lga: chew.lga,
          state: chew.state,
          joinDate: chew.createdAt,
        },
        period,
        performance: {
          registrations: pregnancies.length,
          activeWomen: pregnancies.filter((p) => p.status === "active").length,
          ancCompletionRate: chew.performance?.ancCompletionRate || 0,
          redFlagResponseRate: chew.performance?.redFlagResponseRate || 0,
          totalRedFlags: redFlags.length,
          respondedRedFlags: redFlags.filter(
            (r) => r.followup?.status === "completed",
          ).length,
          avgResponseTime: await this.getCHEWAverageResponseTime(chewId),
          monthlyMetrics: chew.performance?.lastMonthMetrics,
        },
        dailyTrend,
        ranking: {
          percentile: await this.getCHEWPercentile(chewId),
          rank: await this.getCHEWRank(chewId),
        },
      });
    } catch (error) {
      logger.error("Get CHEW performance error:", error);
      res.status(500).json({ error: "Failed to get CHEW performance" });
    }
  }

  // Helper methods
  async getDueVisitsCount(chewId, daysAhead) {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + daysAhead);

    const pregnancies = await Pregnancy.find({ chewId, status: "active" });
    let dueCount = 0;

    for (const pregnancy of pregnancies) {
      const anc = await ANCPregnancy.findOne({ pregnancyId: pregnancy._id });
      const nextVisit = anc?.fmohSchedule.find(
        (v) => !v.attended && v.scheduledDate <= endDate,
      );
      if (nextVisit) dueCount++;
    }

    return dueCount;
  }

  async getOverdueVisitsCount(chewId) {
    const pregnancies = await Pregnancy.find({ chewId, status: "active" });
    let overdueCount = 0;

    for (const pregnancy of pregnancies) {
      const anc = await ANCPregnancy.findOne({ pregnancyId: pregnancy._id });
      const overdue = anc?.fmohSchedule.find(
        (v) => !v.attended && v.scheduledDate < new Date(),
      );
      if (overdue) overdueCount++;
    }

    return overdueCount;
  }

  async getCHEWAverageResponseTime(chewId) {
    const reports = await DangerReport.find({
      chewId,
      triageOutcome: "RED",
      "followup.completedAt": { $exists: true },
    });

    if (reports.length === 0) return null;

    const totalTime = reports.reduce((sum, report) => {
      const responseTime =
        (report.followup.completedAt - report.timestamp) / (1000 * 60);
      return sum + responseTime;
    }, 0);

    return totalTime / reports.length;
  }

  async getWeeklyTrend(chewId) {
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

      weeks.push({
        week: i === 0 ? "This Week" : `${i} weeks ago`,
        registrations,
        redFlags,
      });
    }
    return weeks;
  }

  async getDailyTrend(chewId, startDate) {
    const days = [];
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    // Calculate total days and cap data points to 30 for performance
    const totalDays = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24));
    const maxPoints = 30;
    const step = Math.max(1, Math.ceil(totalDays / maxPoints));

    // Use for loop with explicit iterations to ensure termination
    for (let iterations = 0; iterations < maxPoints; iterations++) {
      const current = new Date(startDate);
      current.setDate(current.getDate() + iterations * step);

      // Stop if we've passed today
      if (current > today) break;

      const date = new Date(current);
      date.setHours(0, 0, 0, 0);

      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const registrations = await Pregnancy.countDocuments({
        chewId,
        registrationDate: { $gte: date, $lt: nextDate },
      });

      const visits = await this.getVisitsForDay(chewId, date);

      days.push({
        date: date.toISOString().split("T")[0],
        registrations,
        visitsCompleted: visits.completed,
        redFlags: await DangerReport.countDocuments({
          chewId,
          timestamp: { $gte: date, $lt: nextDate },
          triageOutcome: "RED",
        }),
      });
    }

    return days;
  }

  async getVisitsForDay(chewId, date) {
    const nextDate = new Date(date);
    nextDate.setDate(nextDate.getDate() + 1);

    // Get all pregnancies for this CHEW (single query)
    const pregnancies = await Pregnancy.find({ chewId });
    const pregnancyIds = pregnancies.map((p) => p._id);

    // Get all ANC records in a single query (not N+1)
    const ancPregnancies = await ANCPregnancy.find({
      pregnancyId: { $in: pregnancyIds },
    });

    // Create a map for O(1) lookups
    const ancMap = new Map(
      ancPregnancies.map((anc) => [anc.pregnancyId.toString(), anc]),
    );

    let scheduled = 0;
    let completed = 0;

    // Now iterate through pregnancies with the map (no additional queries)
    for (const pregnancy of pregnancies) {
      const anc = ancMap.get(pregnancy._id.toString());
      const dayVisits =
        anc?.fmohSchedule.filter(
          (v) => v.scheduledDate >= date && v.scheduledDate < nextDate,
        ) || [];

      scheduled += dayVisits.length;
      completed += dayVisits.filter((v) => v.attended).length;
    }

    return { scheduled, completed };
  }

  async getCHEWANCCompletionRate(chewId) {
    // Get all pregnancies for this CHEW (single query)
    const pregnancies = await Pregnancy.find({ chewId });
    const pregnancyIds = pregnancies.map((p) => p._id);

    // Get all ANC records in a single query (not N+1)
    const ancPregnancies = await ANCPregnancy.find({
      pregnancyId: { $in: pregnancyIds },
    });

    let totalVisits = 0;
    let completedVisits = 0;

    // Iterate through ANC records (already fetched)
    for (const anc of ancPregnancies) {
      if (anc?.fmohSchedule) {
        totalVisits += anc.fmohSchedule.length;
        completedVisits += anc.fmohSchedule.filter((v) => v.attended).length;
      }
    }

    return totalVisits > 0 ? (completedVisits / totalVisits) * 100 : 0;
  }

  async getCHEWPercentile(chewId) {
    const allCHEWs = await CHEWProfile.find();
    const rates = await Promise.all(
      allCHEWs.map((c) => this.getCHEWANCCompletionRate(c.userId)),
    );
    const sortedRates = rates.toSorted((a, b) => b - a);
    const chewRate = await this.getCHEWANCCompletionRate(chewId);
    const rank = sortedRates.findIndex((r) => r <= chewRate) + 1;

    return (rank / sortedRates.length) * 100;
  }

  async getCHEWRank(chewId) {
    const allCHEWs = await CHEWProfile.find();
    const rates = await Promise.all(
      allCHEWs.map((c) => this.getCHEWANCCompletionRate(c.userId)),
    );
    const sortedRates = rates.toSorted((a, b) => b - a);
    const chewRate = await this.getCHEWANCCompletionRate(chewId);

    return sortedRates.findIndex((r) => r <= chewRate) + 1;
  }

  getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  getSymptomName(symptomCode) {
    const symptoms = {
      1: "Heavy bleeding",
      2: "Severe headache",
      3: "Swollen face or hand",
      4: "Blurry vision",
      5: "Fever",
      6: "Reduced baby movement",
      7: "Severe abdominal pain",
      8: "Convulsion",
      0: "No symptoms",
    };
    return symptoms[symptomCode] || "Unknown";
  }

  /**
   * Get triage distribution for dashboard
   */
  async getTriageDistribution(req, res) {
    try {
      const { chewId, lga, state } = req.query;
      let query = {};

      if (chewId) {
        query.chewId = chewId;
      } else if (lga || state) {
        const chews = await CHEWProfile.find({
          ...(lga && { lga }),
          ...(state && { state }),
        });
        query.chewId = { $in: chews.map((c) => c.userId) };
      }

      // Get active pregnancies with their latest danger reports
      const pregnancies = await Pregnancy.find({
        ...query,
        status: "active",
      }).populate("womanId");

      // Get latest triage for each pregnancy
      const triageCounts = {
        GREEN: 0,
        YELLOW: 0,
        RED: 0,
      };

      for (const pregnancy of pregnancies) {
        const latestReport = await DangerReport.findOne({
          pregnancyId: pregnancy._id,
        }).sort({ timestamp: -1 });

        const triage = latestReport?.triageOutcome || "GREEN";
        triageCounts[triage] = (triageCounts[triage] || 0) + 1;
      }

      const total = pregnancies.length;

      res.json({
        success: true,
        triageDistribution: {
          GREEN: {
            count: triageCounts.GREEN,
            percentage: total
              ? ((triageCounts.GREEN / total) * 100).toFixed(1)
              : 0,
          },
          YELLOW: {
            count: triageCounts.YELLOW,
            percentage: total
              ? ((triageCounts.YELLOW / total) * 100).toFixed(1)
              : 0,
          },
          RED: {
            count: triageCounts.RED,
            percentage: total
              ? ((triageCounts.RED / total) * 100).toFixed(1)
              : 0,
          },
        },
        totalPatients: total,
      });
    } catch (error) {
      logger.error("Get triage distribution error:", error);
      res.status(500).json({ error: "Failed to get triage distribution" });
    }
  }

  /**
   * Get patients grouped by location
   */
  async getPatientsByLocation(req, res) {
    try {
      const { chewId, lga, state } = req.query;
      let query = {};

      if (chewId) {
        query.chewId = chewId;
      } else if (lga || state) {
        const chews = await CHEWProfile.find({
          ...(lga && { lga }),
          ...(state && { state }),
        });
        query.chewId = { $in: chews.map((c) => c.userId) };
      }

      const pregnancies = await Pregnancy.find(query).populate(
        "womanId",
        "address state lga city",
      );

      // Group by location
      const locationMap = new Map();

      for (const pregnancy of pregnancies) {
        const location =
          pregnancy.womanId?.city ||
          pregnancy.womanId?.lga ||
          pregnancy.womanId?.state ||
          "Unknown";

        locationMap.set(location, (locationMap.get(location) || 0) + 1);
      }

      const locations = Array.from(locationMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);

      res.json({
        success: true,
        locations,
        totalLocations: locations.length,
      });
    } catch (error) {
      logger.error("Get patients by location error:", error);
      res.status(500).json({ error: "Failed to get location distribution" });
    }
  }

  /**
   * Get gestational week distribution histogram
   */
  async getGestationalWeekDistribution(req, res) {
    try {
      const { chewId, lga, state } = req.query;
      let query = {};

      if (chewId) {
        query.chewId = chewId;
      } else if (lga || state) {
        const chews = await CHEWProfile.find({
          ...(lga && { lga }),
          ...(state && { state }),
        });
        query.chewId = { $in: chews.map((c) => c.userId) };
      }

      const pregnancies = await Pregnancy.find({ ...query, status: "active" });

      // Define week ranges
      const weekRanges = [
        { label: "0-12", min: 0, max: 12 },
        { label: "13-20", min: 13, max: 20 },
        { label: "21-28", min: 21, max: 28 },
        { label: "29-36", min: 29, max: 36 },
        { label: "37-40", min: 37, max: 40 },
        { label: "40+", min: 41, max: 99 },
      ];

      const distribution = weekRanges.map((range) => ({
        range: range.label,
        count: pregnancies.filter(
          (p) =>
            p.gestationalWeek >= range.min && p.gestationalWeek <= range.max,
        ).length,
      }));

      res.json({
        success: true,
        distribution,
        totalPatients: pregnancies.length,
        averageWeek: pregnancies.length
          ? (
              pregnancies.reduce((sum, p) => sum + p.gestationalWeek, 0) /
              pregnancies.length
            ).toFixed(1)
          : 0,
      });
    } catch (error) {
      logger.error("Get gestational distribution error:", error);
      res.status(500).json({ error: "Failed to get gestational distribution" });
    }
  }

  /**
   * Get missed visits broken down by triage level
   */
  async getMissedVisitsByTriage(req, res) {
    try {
      const { chewId, lga, state } = req.query;
      let query = {};

      if (chewId) {
        query.chewId = chewId;
      } else if (lga || state) {
        const chews = await CHEWProfile.find({
          ...(lga && { lga }),
          ...(state && { state }),
        });
        query.chewId = { $in: chews.map((c) => c.userId) };
      }

      const pregnancies = await Pregnancy.find({ ...query, status: "active" });

      // Get triage for each pregnancy
      const triageMap = new Map();

      for (const pregnancy of pregnancies) {
        const latestReport = await DangerReport.findOne({
          pregnancyId: pregnancy._id,
        }).sort({ timestamp: -1 });

        const triage = latestReport?.triageOutcome || "GREEN";

        // Get ANC schedule
        const anc = await ANCPregnancy.findOne({ pregnancyId: pregnancy._id });
        const missedVisits =
          anc?.fmohSchedule?.filter(
            (v) => !v.attended && v.scheduledDate < new Date(),
          ).length || 0;

        if (!triageMap.has(triage)) {
          triageMap.set(triage, { missedVisits: 0, patients: 0 });
        }

        const stats = triageMap.get(triage);
        stats.missedVisits += missedVisits;
        stats.patients++;
      }

      const missedVisitsData = Array.from(triageMap.entries()).map(
        ([triage, data]) => ({
          triage,
          missedVisits: data.missedVisits,
          patients: data.patients,
          avgMissedPerPatient: (data.missedVisits / data.patients).toFixed(1),
        }),
      );

      res.json({
        success: true,
        missedVisits: missedVisitsData,
        totalMissedVisits: missedVisitsData.reduce(
          (sum, d) => sum + d.missedVisits,
          0,
        ),
      });
    } catch (error) {
      logger.error("Get missed visits by triage error:", error);
      res.status(500).json({ error: "Failed to get missed visits data" });
    }
  }

  /**
   * Get patient count ranges (for histogram visualization)
   */
  async getPatientCountRanges(req, res) {
    try {
      const { groupBy = "chew", lga, state } = req.query;

      let counts = [];

      if (groupBy === "chew") {
        // Get counts per CHEW
        const chews = await CHEWProfile.find({
          ...(lga && { lga }),
          ...(state && { state }),
        });

        for (const chew of chews) {
          const count = await Pregnancy.countDocuments({ chewId: chew.userId });
          counts.push(count);
        }
      } else if (groupBy === "lga") {
        // Get counts per LGA
        const lgas = await CHEWProfile.distinct("lga", {
          ...(state && { state }),
        });

        for (const lgaName of lgas) {
          const chewsInLga = await CHEWProfile.find({ lga: lgaName });
          const chewIds = chewsInLga.map((c) => c.userId);
          const count = await Pregnancy.countDocuments({
            chewId: { $in: chewIds },
          });
          counts.push(count);
        }
      }

      // Create range buckets
      const ranges = [
        { label: "0-10", min: 0, max: 10, count: 0 },
        { label: "11-25", min: 11, max: 25, count: 0 },
        { label: "26-50", min: 26, max: 50, count: 0 },
        { label: "51-75", min: 51, max: 75, count: 0 },
        { label: "76-100", min: 76, max: 100, count: 0 },
        { label: "100+", min: 101, max: Infinity, count: 0 },
      ];

      for (const count of counts) {
        const range = ranges.find((r) => count >= r.min && count <= r.max);
        if (range) range.count++;
      }

      res.json({
        success: true,
        groupBy,
        ranges,
        totalGroups: counts.length,
        averagePatients: counts.length
          ? (counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1)
          : 0,
      });
    } catch (error) {
      logger.error("Get patient count ranges error:", error);
      res.status(500).json({ error: "Failed to get patient count ranges" });
    }
  }

  /**
   * Combined dashboard for frontend (one call to get all data)
   */
  async getFullDashboard(req, res) {
    try {
      const { chewId, lga, state, role = "chew" } = req.query;

      // Set up query params for all helper methods
      const queryParams = { chewId, lga, state };

      // Parallel execution of all dashboard queries
      const [
        triageDistribution,
        locationData,
        gestationalData,
        missedVisitsData,
        patientRanges,
        kpis,
      ] = await Promise.all([
        this.getTriageDistributionData(queryParams),
        this.getLocationData(queryParams),
        this.getGestationalData(queryParams),
        this.getMissedVisitsData(queryParams),
        this.getPatientRangesData({
          ...queryParams,
          groupBy: role === "supervisor" ? "lga" : "chew",
        }),
        this.getKPIData(queryParams),
      ]);

      res.json({
        success: true,
        dashboard: {
          kpis,
          triageDistribution,
          patientsByLocation: locationData,
          gestationalWeekDistribution: gestationalData,
          missedVisitsByTriage: missedVisitsData,
          patientCountDistribution: patientRanges,
          lastUpdated: new Date(),
        },
      });
    } catch (error) {
      logger.error("Get full dashboard error:", error);
      res.status(500).json({ error: "Failed to get dashboard data" });
    }
  }

  // Helper methods for combined dashboard
  async getTriageDistributionData(params) {
    // Implementation similar to getTriageDistribution but returns data only
    let query = {};
    if (params.chewId) query.chewId = params.chewId;

    const pregnancies = await Pregnancy.find({ ...query, status: "active" });
    const triageCounts = { GREEN: 0, YELLOW: 0, RED: 0 };

    for (const pregnancy of pregnancies) {
      const latestReport = await DangerReport.findOne({
        pregnancyId: pregnancy._id,
      }).sort({ timestamp: -1 });
      const triage = latestReport?.triageOutcome || "GREEN";
      triageCounts[triage]++;
    }

    const total = pregnancies.length;
    return {
      GREEN: {
        percentage: total ? ((triageCounts.GREEN / total) * 100).toFixed(1) : 0,
      },
      YELLOW: {
        percentage: total
          ? ((triageCounts.YELLOW / total) * 100).toFixed(1)
          : 0,
      },
      RED: {
        percentage: total ? ((triageCounts.RED / total) * 100).toFixed(1) : 0,
      },
    };
  }

  async getLocationData(params) {
    let query = {};
    if (params.chewId) query.chewId = params.chewId;

    const pregnancies = await Pregnancy.find(query).populate(
      "womanId",
      "city lga state",
    );
    const locationMap = new Map();

    for (const pregnancy of pregnancies) {
      const location =
        pregnancy.womanId?.city || pregnancy.womanId?.lga || "Unknown";
      locationMap.set(location, (locationMap.get(location) || 0) + 1);
    }

    return Array.from(locationMap.entries()).map(([name, count]) => ({
      name,
      count,
    }));
  }

  async getGestationalData(params) {
    let query = {};
    if (params.chewId) query.chewId = params.chewId;

    const pregnancies = await Pregnancy.find({ ...query, status: "active" });
    const weekRanges = [
      { range: "0-12", min: 0, max: 12 },
      { range: "13-20", min: 13, max: 20 },
      { range: "21-28", min: 21, max: 28 },
      { range: "29-36", min: 29, max: 36 },
      { range: "37-40", min: 37, max: 40 },
      { range: "40+", min: 41, max: 99 },
    ];

    return weekRanges.map((range) => ({
      range: range.range,
      count: pregnancies.filter(
        (p) => p.gestationalWeek >= range.min && p.gestationalWeek <= range.max,
      ).length,
    }));
  }

  async getMissedVisitsData(params) {
    let query = {};
    if (params.chewId) query.chewId = params.chewId;

    const pregnancies = await Pregnancy.find({ ...query, status: "active" });
    const triageMap = new Map();

    for (const pregnancy of pregnancies) {
      const latestReport = await DangerReport.findOne({
        pregnancyId: pregnancy._id,
      }).sort({ timestamp: -1 });
      const triage = latestReport?.triageOutcome || "GREEN";

      const anc = await ANCPregnancy.findOne({ pregnancyId: pregnancy._id });
      const missedVisits =
        anc?.fmohSchedule?.filter(
          (v) => !v.attended && v.scheduledDate < new Date(),
        ).length || 0;

      triageMap.set(triage, (triageMap.get(triage) || 0) + missedVisits);
    }

    return Array.from(triageMap.entries()).map(([triage, missedVisits]) => ({
      triage,
      missedVisits,
    }));
  }

  async getPatientRangesData(params) {
    const { groupBy = "chew", lga, state } = params;
    let counts = [];

    if (groupBy === "chew") {
      const chews = await CHEWProfile.find({
        ...(lga && { lga }),
        ...(state && { state }),
      });
      for (const chew of chews) {
        const count = await Pregnancy.countDocuments({ chewId: chew.userId });
        counts.push(count);
      }
    }

    const ranges = [
      { label: "0-10", min: 0, max: 10, count: 0 },
      { label: "11-25", min: 11, max: 25, count: 0 },
      { label: "26-50", min: 26, max: 50, count: 0 },
      { label: "51-75", min: 51, max: 75, count: 0 },
      { label: "76-100", min: 76, max: 100, count: 0 },
      { label: "100+", min: 101, max: Infinity, count: 0 },
    ];

    for (const count of counts) {
      const range = ranges.find((r) => count >= r.min && count <= r.max);
      if (range) range.count++;
    }

    return ranges;
  }

  async getKPIData(params) {
    let query = {};
    if (params.chewId) query.chewId = params.chewId;

    const totalWomen = await Pregnancy.countDocuments(query);
    const activePregnancies = await Pregnancy.countDocuments({
      ...query,
      status: "active",
    });
    const highRiskWomen = await Pregnancy.countDocuments({
      ...query,
      riskFactors: { $exists: true, $ne: [] },
    });

    return { totalWomen, activePregnancies, highRiskWomen };
  }
}

export default new DashboardController();
