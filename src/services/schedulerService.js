import cron from "node-cron";
import Pregnancy from "../models/Pregnancy.js";
import ANCPregnancy from "../models/ANCPregnancy.js";
import CHEWProfile from "../models/CHEWProfile.js";
import MessagingService from "./messagingService.js";
import SystemEvent from "../models/SystemEvent.js";

class SchedulerService {
  constructor() {
    this.jobs = new Map();
  }

  startAll() {
    this.startReminderScheduler();
    this.startWeeklyCheckinScheduler();
    this.startMissedVisitTracker();
    this.startQueueProcessor();
    this.startPerformanceAggregator();
    console.log("All schedulers started");
  }

  startReminderScheduler() {
    const job = cron.schedule("0 6 * * *", async () => {
      console.log("Running reminder scheduler...", new Date().toISOString());
      await this.processDailyReminders();
    });
    this.jobs.set("reminder", job);
  }

  startWeeklyCheckinScheduler() {
    // Run daily at 8:00 AM instead of only on Sundays
    const job = cron.schedule("0 8 * * *", async () => {
      console.log("Running rolling weekly check-in scheduler...");
      await this.processWeeklyCheckins();
    });
    this.jobs.set("weeklyCheckin", job);
  }

  startMissedVisitTracker() {
    const job = cron.schedule("30 6 * * *", async () => {
      console.log("Running missed visit tracker...");
      await this.trackMissedVisits();
    });
    this.jobs.set("missedVisit", job);
  }

  startQueueProcessor() {
    // Run every 30 seconds
    setInterval(async () => {
      await MessagingService.processQueue();
    }, 30000);
  }

  startPerformanceAggregator() {
    // Run daily at midnight
    const job = cron.schedule("0 0 * * *", async () => {
      console.log("Running performance aggregation...");
      await this.aggregatePerformanceMetrics();
    });
    this.jobs.set("performance", job);
  }

  async processDailyReminders() {
    try {
      const pregnancies = await Pregnancy.find({ status: "active" }).populate(
        "womanId",
      );

      for (const pregnancy of pregnancies) {
        await this.sendRemindersForPregnancy(pregnancy);
      }
    } catch (error) {
      await this.logError("DAILY_REMINDER_FAILURE", error);
    }
  }

  async sendRemindersForPregnancy(pregnancy) {
    const ancPregnancy = await ANCPregnancy.findOne({
      pregnancyId: pregnancy._id,
    });
    const today = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(today.getDate() + 7);

    const dueVisits = ancPregnancy.fmohSchedule.filter(
      (visit) =>
        !visit.attended &&
        !visit.reminderSent &&
        visit.scheduledDate <= nextWeek,
    );

    for (const visit of dueVisits) {
      await MessagingService.sendANCReminder(pregnancy, visit);
      visit.reminderSent = true;
      visit.reminderDate = new Date();
    }

    await ancPregnancy.save();
  }

  async processWeeklyCheckins() {
    const pregnancies = await Pregnancy.find({
      status: "active",
      lastCheckin: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }).populate("womanId");

    for (const pregnancy of pregnancies) {
      await MessagingService.sendWeeklyCheckin(pregnancy);
      pregnancy.lastCheckin = new Date();
      await pregnancy.save();
    }
  }

  async trackMissedVisits() {
    const pregnancies = await Pregnancy.find({ status: "active" });

    for (const pregnancy of pregnancies) {
      const ancPregnancy = await ANCPregnancy.findOne({
        pregnancyId: pregnancy._id,
      });
      const missed = ancPregnancy.fmohSchedule.filter(
        (visit) =>
          !visit.attended &&
          visit.scheduledDate < new Date() &&
          !visit.missedLogged,
      );

      for (const visit of missed) {
        ancPregnancy.missedVisits.push({
          weekNumber: visit.weekNumber,
          missedDate: new Date(),
          chewNotified: false,
        });
        visit.missedLogged = true;

        // Notify CHEW of missed visit
        await MessagingService.notifyMissedVisit(pregnancy, visit);
      }

      await ancPregnancy.save();
    }
  }

  async aggregatePerformanceMetrics() {
    const chews = await CHEWProfile.find({ isActive: true });

    for (const chew of chews) {
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
        const attendedVisits = ancPregnancy.fmohSchedule.filter(
          (v) => v.attended,
        ).length;
        ancCompleted += attendedVisits;
        totalVisits += ancPregnancy.fmohSchedule.length;
      }

      chew.performance.ancCompletionRate =
        totalVisits > 0 ? (ancCompleted / totalVisits) * 100 : 0;
      chew.performance.lastMonthMetrics.womenRegistered = pregnancies.length;
      await chew.save();
    }
  }

  async logError(type, error) {
    await SystemEvent.create({
      type,
      severity: "CRITICAL",
      message: error.message,
      details: { error: error.toString(), stack: error.stack },
      notificationSent: { slack: false },
    });
  }

  stopAll() {
    for (const [name, job] of this.jobs) {
      job.stop();
      console.log(`Stopped ${name} scheduler`);
    }
  }
}

export default new SchedulerService();
