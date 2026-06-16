import cron from "node-cron";
import Pregnancy from "../models/Pregnancy.js";
import ANCPregnancy from "../models/ANCPregnancy.js";
import CHEWProfile from "../models/CHEWProfile.js";
import MessagingService from "./messagingService.js";
import SystemEvent from "../models/SystemEvent.js";
import logger from "../utils/logger.js";

class SchedulerService {
  constructor() {
    this.jobs = new Map();
    this.intervals = new Map(); // Track intervals for cleanup
    this.isRunning = false;
  }

  startAll() {
    if (this.isRunning) {
      logger.warn("Schedulers already running");
      return;
    }

    logger.info("🔄 Starting all schedulers...");

    this.startReminderScheduler();
    this.startWeeklyCheckinScheduler();
    this.startMissedVisitTracker();
    this.startQueueProcessor();
    this.startPerformanceAggregator();

    this.isRunning = true;
    logger.info("✅ All schedulers started");
  }

  /**
   * Reminder Scheduler - Runs daily at 6:00 AM UTC (7:00 AM WAT)
   * Sends ANC visit reminders to women due in the next 7 days
   */
  startReminderScheduler() {
    const job = cron.schedule("0 6 * * *", async () => {
      logger.info("🔄 Running reminder scheduler...");
      const startTime = Date.now();
      try {
        await this.processDailyReminders();
        logger.info(
          `✅ Reminder scheduler completed in ${Date.now() - startTime}ms`,
        );
      } catch (error) {
        logger.error("❌ Reminder scheduler failed:", error);
        await this.logError("DAILY_REMINDER_FAILURE", error);
      }
    });
    this.jobs.set("reminder", job);
    logger.info(
      "✅ Reminder scheduler started (daily at 06:00 UTC / 07:00 WAT)",
    );
  }

  /**
   * Weekly Check-in Scheduler - Runs every Monday at 5:00 AM UTC (6:00 AM WAT)
   * Sends weekly check-ins to women who are due (7 days after registration or last check-in)
   * PRD: Every 7 days from her registration date
   */
  startWeeklyCheckinScheduler() {
    const job = cron.schedule("0 5 * * 1", async () => {
      logger.info("🔄 Running weekly check-in scheduler...");
      const startTime = Date.now();
      try {
        await this.processWeeklyCheckins();
        logger.info(
          `✅ Weekly check-in scheduler completed in ${Date.now() - startTime}ms`,
        );
      } catch (error) {
        logger.error("❌ Weekly check-in scheduler failed:", error);
        await this.logError("WEEKLY_CHECKIN_FAILURE", error);
      }
    });
    this.jobs.set("weeklyCheckin", job);
    logger.info(
      "✅ Weekly check-in scheduler started (every Monday at 05:00 UTC / 06:00 WAT)",
    );

    // Recovery job at 2:00 PM UTC (3:00 PM WAT) for missed check-ins
    const recoveryJob = cron.schedule("0 14 * * *", async () => {
      logger.info("🔄 Running weekly check-in recovery...");
      try {
        await this.recoverMissedCheckins();
      } catch (error) {
        logger.error("❌ Weekly check-in recovery failed:", error);
      }
    });
    this.jobs.set("weeklyCheckinRecovery", recoveryJob);
    logger.info(
      "✅ Weekly check-in recovery started (daily at 14:00 UTC / 15:00 WAT)",
    );
  }

  /**
   * Missed Visit Tracker - Runs daily at 6:30 AM UTC (7:30 AM WAT)
   * 30 minutes after reminder scheduler to avoid DB contention
   */
  startMissedVisitTracker() {
    const job = cron.schedule("30 6 * * *", async () => {
      logger.info("🔄 Running missed visit tracker...");
      const startTime = Date.now();
      try {
        await this.trackMissedVisits();
        logger.info(
          `✅ Missed visit tracker completed in ${Date.now() - startTime}ms`,
        );
      } catch (error) {
        logger.error("❌ Missed visit tracker failed:", error);
        await this.logError("MISSED_VISIT_TRACKER_FAILURE", error);
      }
    });
    this.jobs.set("missedVisit", job);
    logger.info(
      "✅ Missed visit tracker started (daily at 06:30 UTC / 07:30 WAT)",
    );
  }

  /**
   * Queue Processor - Runs every 30 seconds
   * Processes the message queue
   */
  startQueueProcessor() {
    const interval = setInterval(async () => {
      try {
        await MessagingService.processQueue();
      } catch (error) {
        logger.error("❌ Queue processor error:", error);
      }
    }, 30000);
    this.intervals.set("queueProcessor", interval);
    logger.info("✅ Queue processor started (every 30 seconds)");
  }

  /**
   * Performance Aggregator - Runs daily at 00:00 UTC (01:00 WAT)
   * Aggregates CHEW performance metrics
   */
  startPerformanceAggregator() {
    const job = cron.schedule("0 0 * * *", async () => {
      logger.info("🔄 Running performance aggregation...");
      const startTime = Date.now();
      try {
        await this.aggregatePerformanceMetrics();
        logger.info(
          `✅ Performance aggregation completed in ${Date.now() - startTime}ms`,
        );
      } catch (error) {
        logger.error("❌ Performance aggregation failed:", error);
        await this.logError("PERFORMANCE_AGGREGATION_FAILURE", error);
      }
    });
    this.jobs.set("performance", job);
    logger.info(
      "✅ Performance aggregator started (daily at 00:00 UTC / 01:00 WAT)",
    );
  }

  /**
   * Process daily ANC reminders
   * Sends reminders to women with visits due in the next 7 days
   */
  async processDailyReminders() {
    const pregnancies = await Pregnancy.find({
      status: "active",
      gestationalWeek: { $gte: 4, $lte: 42 },
    }).populate("womanId");

    let sent = 0;
    let errors = 0;

    for (const pregnancy of pregnancies) {
      try {
        const ancPregnancy = await ANCPregnancy.findOne({
          pregnancyId: pregnancy._id,
        });
        if (!ancPregnancy) continue;

        const today = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(today.getDate() + 7);

        const dueVisits = ancPregnancy.fmohSchedule.filter(
          (visit) =>
            !visit.attended &&
            !visit.reminderSent &&
            visit.scheduledDate <= nextWeek &&
            visit.scheduledDate >= today,
        );

        for (const visit of dueVisits) {
          await MessagingService.sendANCReminder(pregnancy, visit);
          visit.reminderSent = true;
          visit.reminderDate = new Date();
          sent++;
        }

        await ancPregnancy.save();
      } catch (error) {
        errors++;
        logger.error(
          `Error processing reminders for pregnancy ${pregnancy._id}:`,
          error,
        );
      }
    }

    if (sent > 0 || errors > 0) {
      logger.info(`📨 Reminders sent: ${sent}, Errors: ${errors}`);
    }
  }

  /**
   * Process weekly check-ins based on individual registration dates
   * PRD: Every 7 days from her registration date
   * Only sends to women who haven't received a check-in in the last 7 days
   */
  async processWeeklyCheckins() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const pregnancies = await Pregnancy.find({
      status: "active",
      gestationalWeek: { $gte: 8, $lte: 42 },
      $or: [
        { lastCheckin: { $lt: sevenDaysAgo } },
        { lastCheckin: { $exists: false } },
      ],
    }).populate("womanId");

    let sent = 0;
    let skipped = 0;
    let errors = 0;

    for (const pregnancy of pregnancies) {
      try {
        // Don't send if opted out
        if (pregnancy.womanId?.optOut?.isOptedOut) {
          skipped++;
          continue;
        }

        // Don't send if has active RED flag
        const hasActiveRedFlag = await this.hasActiveRedFlag(pregnancy._id);
        if (hasActiveRedFlag) {
          skipped++;
          continue;
        }

        // Check if exactly 7 days have passed since registration or last check-in
        const lastCheckin = pregnancy.lastCheckin || pregnancy.registrationDate;
        const daysSinceLastCheckin = Math.floor(
          (Date.now() - new Date(lastCheckin).getTime()) /
            (1000 * 60 * 60 * 24),
        );

        // Only send if 7 or more days have passed
        if (daysSinceLastCheckin >= 7) {
          await MessagingService.sendWeeklyCheckin(pregnancy);
          pregnancy.lastCheckin = new Date();
          await pregnancy.save();
          sent++;
        } else {
          skipped++;
        }
      } catch (error) {
        errors++;
        logger.error(
          `Error sending weekly check-in for pregnancy ${pregnancy._id}:`,
          error,
        );
      }
    }

    if (sent > 0 || skipped > 0 || errors > 0) {
      logger.info(
        `💬 Weekly check-ins sent: ${sent}, Skipped: ${skipped}, Errors: ${errors}`,
      );
    }

    // Log metrics
    if (sent > 0 || errors > 0) {
      let severity = "LOW";
      if (errors > 10) {
        severity = "HIGH";
      } else if (errors > 0) {
        severity = "MEDIUM";
      }

      await SystemEvent.create({
        type: "WEEKLY_CHECKIN_BATCH",
        severity,
        message: `Weekly check-in batch completed`,
        details: {
          sent,
          skipped,
          errors,
          timestamp: new Date(),
        },
      });
    }
  }

  /**
   * Recover missed check-ins (women who didn't receive due to technical issues)
   */
  async recoverMissedCheckins() {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 14); // Check last 14 days

    const pregnancies = await Pregnancy.find({
      status: "active",
      gestationalWeek: { $gte: 8, $lte: 42 },
      lastCheckin: { $lt: sevenDaysAgo },
    }).populate("womanId");

    let recovered = 0;

    for (const pregnancy of pregnancies) {
      try {
        // Check if any check-in was sent in the last 7 days
        const MessageQueue = (await import("../models/MessageQueue.js"))
          .default;
        const recentCheckin = await MessageQueue.findOne({
          "metadata.pregnancyId": pregnancy._id,
          type: "weekly_checkin",
          createdAt: { $gte: sevenDaysAgo },
        });

        if (!recentCheckin) {
          await MessagingService.sendWeeklyCheckin(pregnancy);
          pregnancy.lastCheckin = new Date();
          await pregnancy.save();
          recovered++;
        }
      } catch (error) {
        logger.error(
          `Error recovering check-in for pregnancy ${pregnancy._id}:`,
          error,
        );
      }
    }

    if (recovered > 0) {
      logger.info(`♻️ Recovered ${recovered} missed check-ins`);
    }
  }

  /**
   * Check if pregnancy has active RED flag
   */
  async hasActiveRedFlag(pregnancyId) {
    const DangerReport = (await import("../models/DangerReport.js")).default;
    const activeRedFlag = await DangerReport.findOne({
      pregnancyId: pregnancyId,
      triageOutcome: "RED",
      "followup.status": { $in: ["pending", "in_progress"] },
    });
    return !!activeRedFlag;
  }

  /**
   * Track missed visits
   * Finds visits that were scheduled in the past but not attended
   */
  async trackMissedVisits() {
    const pregnancies = await Pregnancy.find({
      status: "active",
      gestationalWeek: { $gte: 4, $lte: 42 },
    });

    let missedCount = 0;
    let notified = 0;

    for (const pregnancy of pregnancies) {
      try {
        const ancPregnancy = await ANCPregnancy.findOne({
          pregnancyId: pregnancy._id,
        });
        if (!ancPregnancy) continue;

        const missed = ancPregnancy.fmohSchedule.filter(
          (visit) =>
            !visit.attended &&
            visit.scheduledDate < new Date() &&
            !visit.missedLogged,
        );

        for (const visit of missed) {
          const daysLate = Math.floor(
            (Date.now() - new Date(visit.scheduledDate).getTime()) /
              (1000 * 60 * 60 * 24),
          );

          ancPregnancy.missedVisits.push({
            weekNumber: visit.weekNumber,
            milestoneNumber: visit.milestoneNumber,
            scheduledDate: visit.scheduledDate,
            missedDate: new Date(),
            daysLate: daysLate,
            chewNotified: false,
            supervisorNotified: false,
            escalationLevel: daysLate > 14 ? 2 : daysLate > 7 ? 1 : 0,
          });
          visit.missedLogged = true;
          missedCount++;

          // Notify CHEW of missed visit
          await MessagingService.notifyMissedVisit(pregnancy, visit);
          notified++;
        }

        await ancPregnancy.save();
      } catch (error) {
        logger.error(
          `Error tracking missed visits for pregnancy ${pregnancy._id}:`,
          error,
        );
      }
    }

    if (missedCount > 0) {
      logger.info(
        `📋 Missed visits tracked: ${missedCount}, CHEWs notified: ${notified}`,
      );

      let severity = "LOW";
      if (missedCount > 20) {
        severity = "HIGH";
      } else if (missedCount > 5) {
        severity = "MEDIUM";
      }

      await SystemEvent.create({
        type: "MISSED_VISIT_TRACKING",
        severity,
        message: `Missed visit tracking completed`,
        details: {
          missedCount,
          notified,
          timestamp: new Date(),
        },
      });
    }
  }

  /**
   * Aggregate CHEW performance metrics
   * Calculates ANC completion rates and other KPIs for each CHEW
   */
  async aggregatePerformanceMetrics() {
    const chews = await CHEWProfile.find({ isActive: true });

    let aggregated = 0;

    for (const chew of chews) {
      try {
        const pregnancies = await Pregnancy.find({
          chewId: chew.userId,
          registrationDate: {
            $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        });

        let ancCompleted = 0;
        let totalVisits = 0;

        for (const pregnancy of pregnancies) {
          const ancPregnancy = await ANCPregnancy.findOne({
            pregnancyId: pregnancy._id,
          });
          if (ancPregnancy) {
            const attendedVisits = ancPregnancy.fmohSchedule.filter(
              (v) => v.attended,
            ).length;
            ancCompleted += attendedVisits;
            totalVisits += ancPregnancy.fmohSchedule.length;
          }
        }

        chew.performance.ancCompletionRate =
          totalVisits > 0 ? (ancCompleted / totalVisits) * 100 : 0;
        chew.performance.lastMonthMetrics.womenRegistered = pregnancies.length;
        await chew.save();
        aggregated++;
      } catch (error) {
        logger.error(
          `Error aggregating performance for CHEW ${chew.userId}:`,
          error,
        );
      }
    }

    if (aggregated > 0) {
      logger.info(`📊 Performance metrics aggregated for ${aggregated} CHEWs`);
    }
  }

  /**
   * Log error to system events
   */
  async logError(type, error) {
    try {
      await SystemEvent.create({
        type,
        severity: "CRITICAL",
        message: error.message || "Scheduler error",
        details: {
          error: error.toString(),
          stack: error.stack,
          timestamp: new Date(),
        },
        notificationSent: { slack: false },
      });
    } catch (logError) {
      logger.error("Failed to log scheduler error:", logError);
    }
  }

  /**
   * Stop all schedulers and intervals
   */
  stopAll() {
    logger.info("🛑 Stopping all schedulers...");

    // Stop cron jobs
    for (const [name, job] of this.jobs) {
      try {
        job.stop();
        logger.info(`✅ Stopped ${name} scheduler`);
      } catch (error) {
        logger.error(`❌ Failed to stop ${name} scheduler:`, error);
      }
    }
    this.jobs.clear();

    // Stop intervals
    for (const [name, interval] of this.intervals) {
      try {
        clearInterval(interval);
        logger.info(`✅ Stopped ${name} interval`);
      } catch (error) {
        logger.error(`❌ Failed to stop ${name} interval:`, error);
      }
    }
    this.intervals.clear();

    this.isRunning = false;
    logger.info("✅ All schedulers stopped");
  }

  /**
   * Get scheduler status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.jobs.keys()),
      activeIntervals: Array.from(this.intervals.keys()),
      jobCount: this.jobs.size,
      intervalCount: this.intervals.size,
    };
  }
}

export default new SchedulerService();
