import cron from "node-cron";
import Pregnancy from "../models/Pregnancy.js";
import ANCPregnancy from "../models/ANCPregnancy.js";
import ReminderService from "../services/reminderService.js";
import SystemEvent from "../models/SystemEvent.js";
import logger from "../utils/logger.js";

class ReminderScheduler {
  /**
   * Start the reminder scheduler
   */
  start() {
    // Run daily at 7:00 AM UTC (8:00 AM WAT)
    const schedule = "0 7 * * *";

    cron.schedule(schedule, async () => {
      await this.processReminders();
    });

    logger.info("Reminder scheduler started - running daily at 8:00 AM WAT");
  }

  /**
   * Process all reminders for the day
   */
  async processReminders() {
    if (this.isRunning) {
      logger.warn("Reminder scheduler already running, skipping");
      return;
    }

    this.isRunning = true;
    logger.info("Starting reminder processing...");

    try {
      // Get all active pregnancies
      const pregnancies = await Pregnancy.find({
        status: "active",
        gestationalWeek: { $gte: 4, $lte: 42 },
      }).populate("womanId");

      let ancRemindersSent = 0;
      let appointmentRemindersSent = 0;
      let trustedRemindersSent = 0;

      for (const pregnancy of pregnancies) {
        try {
          const ancPregnancy = await ANCPregnancy.findOne({
            pregnancyId: pregnancy._id,
          });
          if (!ancPregnancy) continue;

          // Process ANC milestone reminders
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
            await ReminderService.sendANCReminder(pregnancy, visit, false);
            ancRemindersSent++;

            // Send to trusted contact
            await ReminderService.sendTrustedReminder(pregnancy, visit);
            trustedRemindersSent++;
          }

          // Process appointment reminders (3 days before)
          const upcomingVisits = ancPregnancy.fmohSchedule.filter((visit) => {
            const today = new Date();
            const daysUntil = Math.ceil(
              (visit.scheduledDate - today) / (1000 * 60 * 60 * 24),
            );
            return !visit.attended && daysUntil === 3;
          });

          if (upcomingVisits.length > 0) {
            await ReminderService.sendAppointmentReminder(pregnancy);
            appointmentRemindersSent += upcomingVisits.length;
          }

          // Send follow-up for missed visits (7 days after)
          const missedVisits = ancPregnancy.fmohSchedule.filter((visit) => {
            const today = new Date();
            const daysSince = Math.floor(
              (today - visit.scheduledDate) / (1000 * 60 * 60 * 24),
            );
            return !visit.attended && daysSince === 7 && !visit.followupSent;
          });

          for (const visit of missedVisits) {
            await ReminderService.sendANCReminder(pregnancy, visit, true);
          }
        } catch (error) {
          logger.error(
            `Error processing reminders for pregnancy ${pregnancy._id}:`,
            error,
          );
        }
      }

      logger.info(
        `Reminder processing completed: ${ancRemindersSent} ANC reminders, ${appointmentRemindersSent} appointment reminders, ${trustedRemindersSent} trusted reminders`,
      );

      // Log metrics
      await SystemEvent.create({
        type: "REMINDER_PROCESSING",
        severity: "LOW",
        message: `Reminder processing completed`,
        details: {
          ancReminders: ancRemindersSent,
          appointmentReminders: appointmentRemindersSent,
          trustedReminders: trustedRemindersSent,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      logger.error("Reminder processing failed:", error);

      await SystemEvent.create({
        type: "SCHEDULER_FAILURE",
        severity: "CRITICAL",
        message: "Reminder scheduler failed",
        details: {
          error: error.message,
          stack: error.stack,
        },
      });
    } finally {
      this.isRunning = false;
    }
  }
  isRunning = false;
}

export default new ReminderScheduler();
