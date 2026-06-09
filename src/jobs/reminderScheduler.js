import cron from "node-cron";
import Pregnancy from "../models/Pregnancy.js";
import ANCPregnancy from "../models/ANCPregnancy.js";
import ReminderService from "../services/reminderService.js";
import SystemEvent from "../models/SystemEvent.js";
import logger from "../utils/logger.js";

class ReminderScheduler {
  isRunning = false;

  // Job timeout: 30 minutes (1800000 ms)
  jobTimeout = 30 * 60 * 1000;

  // Track last successful run time to detect hangs
  lastRunTime = null;

  /**
   * Start the reminder scheduler
   */
  start() {
    // Run daily at 7:00 AM UTC (8:00 AM WAT)
    const schedule = "0 7 * * *";

    cron.schedule(schedule, async () => {
      // Check if previous run is still hanging
      if (this.isRunning) {
        const timeSinceStart = Date.now() - this.lastRunTime;
        if (timeSinceStart > this.jobTimeout) {
          logger.error(
            `Reminder scheduler is HUNG (${Math.round(timeSinceStart / 1000)}s). Force resetting state.`,
          );
          this.isRunning = false;

          await SystemEvent.create({
            type: "SCHEDULER_HANG_DETECTED",
            severity: "CRITICAL",
            message: "Reminder scheduler detected as hung - force reset",
            details: {
              jobType: "reminderScheduler",
              hangDurationMs: timeSinceStart,
              timestamp: new Date(),
            },
          });
        } else {
          logger.warn("Reminder scheduler already running, skipping");
          return;
        }
      }

      await this.runWithTimeout(() => this.processReminders());
    });

    logger.info("Reminder scheduler started - running daily at 8:00 AM WAT");
  }

  /**
   * Run a job with timeout protection
   * @param {Function} jobFn - Async function to execute
   * @param {number} timeout - Timeout in ms (defaults to jobTimeout)
   * @returns {Promise<any>} Result or throws TimeoutError
   */
  async runWithTimeout(jobFn, timeout = this.jobTimeout) {
    return new Promise((resolve, reject) => {
      // Use shared state object instead of primitive to avoid closure issues
      const state = { completed: false };

      // Timeout handler
      const timeoutId = setTimeout(() => {
        if (!state.completed) {
          state.completed = true;
          this.isRunning = false;
          const err = new Error(`Job timeout after ${timeout}ms`);
          logger.error("Job timeout - force reset", {
            timeout,
            job: "reminderScheduler",
          });
          reject(err);
        }
      }, timeout);

      // Execute job without blocking
      this.executeJobWithTimeout(jobFn, timeoutId, state, resolve, reject);
    });
  }

  /**
   * Execute job and handle completion
   * @private
   */
  async executeJobWithTimeout(jobFn, timeoutId, state, resolve, reject) {
    try {
      const result = await jobFn();

      if (!state.completed) {
        state.completed = true;
        clearTimeout(timeoutId);
        this.lastRunTime = Date.now();
        this.isRunning = false;
        resolve(result);
      }
    } catch (error) {
      if (!state.completed) {
        state.completed = true;
        clearTimeout(timeoutId);
        this.isRunning = false;
        reject(error);
      }
    }
  }

  /**
   * Process all reminders for the day
   */
  async processReminders() {
    this.isRunning = true;
    this.lastRunTime = Date.now();
    logger.info("Starting reminder processing...");

    try {
      // Get all active pregnancies
      const pregnancies = await Pregnancy.find({
        status: "active",
        gestationalWeek: { $gte: 4, $lte: 42 },
      })
        .populate("womanId")
        .lean();

      const stats = await this.processAllReminders(pregnancies);

      logger.info(
        `Reminder processing completed: ${stats.ancRemindersSent} ANC reminders, ${stats.appointmentRemindersSent} appointment reminders, ${stats.trustedRemindersSent} trusted reminders, ${stats.errors} errors`,
      );

      // Log metrics
      await SystemEvent.create({
        type: "REMINDER_PROCESSING",
        severity: "LOW",
        message: `Reminder processing completed`,
        details: {
          ancReminders: stats.ancRemindersSent,
          appointmentReminders: stats.appointmentRemindersSent,
          trustedReminders: stats.trustedRemindersSent,
          errors: stats.errors,
          executionTimeMs: Date.now() - this.lastRunTime,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      logger.error("Reminder processing failed:", error.message);

      await SystemEvent.create({
        type: "SCHEDULER_FAILURE",
        severity: "CRITICAL",
        message: "Reminder scheduler failed",
        details: {
          error: error.message,
          stack: error.stack,
          timestamp: new Date(),
        },
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process reminders for all pregnancies
   * @private
   */
  async processAllReminders(pregnancies) {
    const stats = {
      ancRemindersSent: 0,
      appointmentRemindersSent: 0,
      trustedRemindersSent: 0,
      errors: 0,
    };

    // Get all ANC records in a single query (not N+1)
    const pregnancyIds = pregnancies.map((p) => p._id);
    const ancPregnancies = await ANCPregnancy.find({
      pregnancyId: { $in: pregnancyIds },
    });

    // Create a map for O(1) lookups
    const ancMap = new Map(
      ancPregnancies.map((anc) => [anc.pregnancyId.toString(), anc]),
    );

    for (const pregnancy of pregnancies) {
      try {
        const ancPregnancy = ancMap.get(pregnancy._id.toString());
        if (!ancPregnancy) continue;

        const visitStats = await this.processVisitsForPregnancy(
          pregnancy,
          ancPregnancy,
        );
        stats.ancRemindersSent += visitStats.ancRemindersSent;
        stats.appointmentRemindersSent += visitStats.appointmentRemindersSent;
        stats.trustedRemindersSent += visitStats.trustedRemindersSent;
        stats.errors += visitStats.errors;
      } catch (pregnancyError) {
        logger.error(
          `Error processing reminders for pregnancy ${pregnancy._id}:`,
          pregnancyError,
        );
        stats.errors++;
      }
    }

    return stats;
  }

  /**
   * Process all visit types for a single pregnancy
   * @private
   */
  async processVisitsForPregnancy(pregnancy, ancPregnancy) {
    const stats = {
      ancRemindersSent: 0,
      appointmentRemindersSent: 0,
      trustedRemindersSent: 0,
      errors: 0,
    };

    // Process due visits (milestone reminders + trusted contacts)
    const dueStats = await this.processDueVisits(pregnancy, ancPregnancy);
    stats.ancRemindersSent += dueStats.ancRemindersSent;
    stats.trustedRemindersSent += dueStats.trustedRemindersSent;
    stats.errors += dueStats.errors;

    // Process upcoming visits (appointment reminders)
    const upcomingStats = await this.processUpcomingVisits(
      pregnancy,
      ancPregnancy,
    );
    stats.appointmentRemindersSent += upcomingStats.appointmentRemindersSent;
    stats.errors += upcomingStats.errors;

    // Process missed visits (follow-up reminders)
    const missedStats = await this.processMissedVisits(pregnancy, ancPregnancy);
    stats.errors += missedStats.errors;

    return stats;
  }

  /**
   * Process due visit reminders (7 days or less before visit)
   * @private
   */
  async processDueVisits(pregnancy, ancPregnancy) {
    const stats = { ancRemindersSent: 0, trustedRemindersSent: 0, errors: 0 };

    const dueVisits = ancPregnancy.fmohSchedule.filter((visit) => {
      const today = new Date();
      const daysUntil = Math.ceil(
        (visit.scheduledDate - today) / (1000 * 60 * 60 * 24),
      );
      return (
        !visit.attended &&
        !visit.reminderSent &&
        daysUntil <= 7 &&
        daysUntil >= 0
      );
    });

    for (const visit of dueVisits) {
      try {
        await ReminderService.sendANCReminder(pregnancy, visit, false);
        stats.ancRemindersSent++;

        // Send to trusted contact
        await ReminderService.sendTrustedReminder(pregnancy, visit);
        stats.trustedRemindersSent++;
      } catch (visitError) {
        logger.error(
          `Error sending reminder for pregnancy ${pregnancy._id} visit week ${visit.weekNumber}:`,
          visitError,
        );
        stats.errors++;
      }
    }

    return stats;
  }

  /**
   * Process appointment reminders (3 days before visit)
   * @private
   */
  async processUpcomingVisits(pregnancy, ancPregnancy) {
    const stats = { appointmentRemindersSent: 0, errors: 0 };

    const upcomingVisits = ancPregnancy.fmohSchedule.filter((visit) => {
      const today = new Date();
      const daysUntil = Math.ceil(
        (visit.scheduledDate - today) / (1000 * 60 * 60 * 24),
      );
      return !visit.attended && daysUntil === 3;
    });

    if (upcomingVisits.length > 0) {
      try {
        await ReminderService.sendAppointmentReminder(pregnancy);
        stats.appointmentRemindersSent += upcomingVisits.length;
      } catch (apptError) {
        logger.error(
          `Error sending appointment reminder for pregnancy ${pregnancy._id}:`,
          apptError,
        );
        stats.errors++;
      }
    }

    return stats;
  }

  /**
   * Process missed visit follow-ups (7 days after scheduled date)
   * @private
   */
  async processMissedVisits(pregnancy, ancPregnancy) {
    const stats = { errors: 0 };

    const missedVisits = ancPregnancy.fmohSchedule.filter((visit) => {
      const today = new Date();
      const daysSince = Math.floor(
        (today - visit.scheduledDate) / (1000 * 60 * 60 * 24),
      );
      return !visit.attended && daysSince === 7 && !visit.followupSent;
    });

    for (const visit of missedVisits) {
      try {
        await ReminderService.sendANCReminder(pregnancy, visit, true);
      } catch (missedError) {
        logger.error(
          `Error sending missed visit follow-up for pregnancy ${pregnancy._id}:`,
          missedError,
        );
        stats.errors++;
      }
    }

    return stats;
  }
}

export default new ReminderScheduler();
