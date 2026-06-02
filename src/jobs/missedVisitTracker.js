import cron from "node-cron";
import Pregnancy from "../models/Pregnancy.js";
import ANCPregnancy from "../models/ANCPregnancy.js";
import MessagingService from "../services/messagingService.js";
import SystemEvent from "../models/SystemEvent.js";
import logger from "../utils/logger.js";
import User from "../models/User.js";

class MissedVisitTracker {
  isRunning = false;

  trackingWindow = 7;

  // Job timeout: 30 minutes (1800000 ms)
  jobTimeout = 30 * 60 * 1000;

  // Track last successful run time to detect hangs
  lastRunTime = null;

  escalationLevels = {
    1: { days: 7, action: "send_reminder" },
    2: { days: 14, action: "escalate_to_chew" },
    3: { days: 21, action: "escalate_to_supervisor" },
  };

  /**
   * Start the missed visit tracker scheduler
   * Runs daily at 8:00 AM WAT (7:00 AM UTC)
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
            `Missed visit tracker is HUNG (${Math.round(timeSinceStart / 1000)}s). Force resetting state.`,
          );
          this.isRunning = false;

          await SystemEvent.create({
            type: "SCHEDULER_HANG_DETECTED",
            severity: "CRITICAL",
            message: "Missed visit tracker detected as hung - force reset",
            details: {
              jobType: "missedVisitTracker",
              hangDurationMs: timeSinceStart,
              timestamp: new Date(),
            },
          });
        } else {
          logger.warn("Missed visit tracker already running, skipping");
          return;
        }
      }

      await this.runWithTimeout(() => this.trackMissedVisits());
    });

    logger.info("Missed visit tracker started - running daily at 8:00 AM WAT");
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
            job: "missedVisitTracker",
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
   * Track and process missed visits
   */
  async trackMissedVisits() {
    this.isRunning = true;
    this.lastRunTime = Date.now();
    logger.info("Starting missed visit tracking...");

    try {
      // Get all active pregnancies
      const pregnancies = await Pregnancy.find({ status: "active" })
        .populate("womanId")
        .populate("chewId")
        .lean();

      const stats = await this.processAllMissedVisits(pregnancies);

      logger.info(
        `Missed visit tracking completed: ${stats.totalMissed} missed visits found, ${stats.remindersSent} reminders sent, ${stats.escalations} escalations, ${stats.errors} errors`,
      );

      // Log summary event
      const severity = this.calculateSeverity(stats.totalMissed);
      await SystemEvent.create({
        type: "MISSED_VISIT_TRACKING",
        severity,
        message: `Missed visit tracking completed`,
        details: {
          totalMissed: stats.totalMissed,
          remindersSent: stats.remindersSent,
          escalations: stats.escalations,
          errors: stats.errors,
          executionTimeMs: Date.now() - this.lastRunTime,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      logger.error("Missed visit tracking failed:", error.message);

      await SystemEvent.create({
        type: "SCHEDULER_FAILURE",
        severity: "CRITICAL",
        message: "Missed visit tracker failed",
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
   * Process missed visits for all pregnancies
   * @private
   */
  async processAllMissedVisits(pregnancies) {
    const stats = {
      totalMissed: 0,
      remindersSent: 0,
      escalations: 0,
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

        const visitStats = await this.processMissedVisitsForPregnancy(
          pregnancy,
          ancPregnancy,
        );
        stats.totalMissed += visitStats.totalMissed;
        stats.remindersSent += visitStats.remindersSent;
        stats.escalations += visitStats.escalations;
        stats.errors += visitStats.errors;
      } catch (pregnancyError) {
        logger.error(
          `Error checking pregnancy ${pregnancy._id}:`,
          pregnancyError,
        );
        stats.errors++;
      }
    }

    return stats;
  }

  /**
   * Process all missed visits for a single pregnancy
   * @private
   */
  async processMissedVisitsForPregnancy(pregnancy, ancPregnancy) {
    const stats = {
      totalMissed: 0,
      remindersSent: 0,
      escalations: 0,
      errors: 0,
    };

    // Check for missed visits
    const missedVisits = await this.checkMissedVisits(pregnancy, ancPregnancy);

    if (missedVisits.length === 0) {
      return stats;
    }

    stats.totalMissed = missedVisits.length;

    for (const missedVisit of missedVisits) {
      try {
        const result = await this.processMissedVisit(
          pregnancy,
          ancPregnancy,
          missedVisit,
        );
        stats.remindersSent += result.reminderSent ? 1 : 0;
        stats.escalations += result.escalated ? 1 : 0;
      } catch (visitError) {
        logger.error(
          `Error processing missed visit for pregnancy ${pregnancy._id}:`,
          visitError,
        );
        stats.errors++;
      }
    }

    return stats;
  }

  /**
   * Check for missed visits for a pregnancy
   */
  async checkMissedVisits(pregnancy, ancPregnancy) {
    const missedVisits = [];
    const today = new Date();
    const trackingDate = new Date();
    trackingDate.setDate(trackingDate.getDate() - this.trackingWindow);

    for (const visit of ancPregnancy.fmohSchedule) {
      // Skip if already attended or already marked as missed
      if (visit.attended || visit.missedLogged) continue;

      // Check if visit is past due
      if (visit.scheduledDate < today) {
        const daysLate = Math.floor(
          (today - visit.scheduledDate) / (1000 * 60 * 60 * 24),
        );

        missedVisits.push({
          visit,
          daysLate,
          scheduledDate: visit.scheduledDate,
          milestoneNumber: visit.milestoneNumber,
          weekNumber: visit.weekNumber,
        });
      }
    }

    return missedVisits;
  }

  /**
   * Process a missed visit (send reminders, escalate)
   */
  async processMissedVisit(pregnancy, ancPregnancy, missedVisit) {
    const result = {
      reminderSent: false,
      escalated: false,
      escalationLevel: 0,
    };

    try {
      const { visit, daysLate } = missedVisit;

      const escalationLevel = this.getEscalationLevel(daysLate);

      // Mark as missed in database
      visit.missedLogged = true;
      visit.missedDate = new Date();
      visit.daysLate = daysLate;
      visit.escalationLevel = escalationLevel;

      // Add to missed visits array
      ancPregnancy.missedVisits.push({
        weekNumber: visit.weekNumber,
        milestoneNumber: visit.milestoneNumber,
        scheduledDate: visit.scheduledDate,
        missedDate: new Date(),
        daysLate,
        chewNotified: false,
        supervisorNotified: false,
        escalationLevel,
      });

      await ancPregnancy.save();

      // Send reminders based on escalation level
      if (escalationLevel === 0 && daysLate >= 3) {
        await this.sendMissedVisitReminder(pregnancy, visit);
        result.reminderSent = true;
      }

      await this.handleEscalations(escalationLevel, pregnancy, visit, daysLate);

      logger.warn(
        `Missed visit recorded: Pregnancy ${pregnancy._id}, Week ${visit.weekNumber}, Days late: ${daysLate}, Escalation: ${escalationLevel}`,
      );

      return result;
    } catch (error) {
      logger.error(
        `Error processing missed visit for pregnancy ${pregnancy._id}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Calculate severity based on missed visit count
   * @private
   */
  calculateSeverity(totalMissed) {
    if (totalMissed > 50) return "HIGH";
    if (totalMissed > 20) return "MEDIUM";
    return "LOW";
  }

  getEscalationLevel(daysLate) {
    let escalationLevel = 0;
    for (const [level, config] of Object.entries(this.escalationLevels)) {
      if (daysLate >= config.days) {
        escalationLevel = Number.parseInt(level);
      }
    }
    return escalationLevel;
  }

  async handleEscalations(escalationLevel, pregnancy, visit, daysLate) {
    if (escalationLevel >= 1) {
      await this.escalateToCHEW(pregnancy, visit, daysLate);
    }

    if (escalationLevel >= 2) {
      await this.escalateToSupervisor(pregnancy, visit, daysLate);
    }

    if (escalationLevel >= 3) {
      await this.criticalEscalation(pregnancy, visit, daysLate);
    }
  }

  /**
   * Send missed visit reminder to woman
   */
  async sendMissedVisitReminder(pregnancy, visit) {
    const templates = {
      en: `Dear {{name}}, you missed your ANC visit scheduled for week {{week}}. Please visit {{clinic}} as soon as possible. Your baby's health is important. Reply STOP to unsubscribe.`,
      pidgin: `Dear {{name}}, you miss your ANC visit for week {{week}}. Please go {{clinic}} quick quick. Your pikin health important.`,
      yo: `Olooro {{name}}, o ṣe aṣeyọri ibẹwo ANC rẹ fun ọsẹ {{week}}. Jọwọ ṣabẹwo si {{clinic}} ni kete bi o ti ṣee. Ilera ọmọ rẹ ṣe pataki.`,
      ha: `{{name}}, kin ki ka rasa ziyarar ANC ta mako na mako {{week}}. Don Allah ziyarci {{clinic}} da wuri. Lafiyar jaririnka tana da mahimmanci.`,
      ig: `{{name}}, ị tụfuru nleta ANC gị maka izu {{week}}. Biko gaa {{clinic}} ozigbo. Ahụike nwa gị dị mkpa.`,
    };

    const language = pregnancy.womanId?.preferredLanguage || "en";
    const content = templates[language] || templates.en;
    const message = content
      .replace("{{name}}", pregnancy.womanId?.name?.split(" ")[0] || "Mama")
      .replace("{{week}}", visit.weekNumber)
      .replace("{{clinic}}", pregnancy.clinicName || "your clinic");

    await MessagingService.queueMessage({
      to: pregnancy.womanId.phone,
      content: message,
      language: language,
      type: "missed_visit_reminder",
      priority: "high",
      metadata: {
        pregnancyId: pregnancy._id,
        visitWeek: visit.weekNumber,
        missedDays: visit.daysLate,
        type: "woman_reminder",
      },
    });
  }

  /**
   * Escalate missed visit to CHEW
   */
  async escalateToCHEW(pregnancy, visit, daysLate) {
    if (!pregnancy.chewId) {
      logger.error(`No CHEW assigned for pregnancy ${pregnancy._id}`);
      return;
    }

    const chew = pregnancy.chewId;
    const chewPhone = chew.phone || chew.userId?.phone;

    if (!chewPhone) {
      logger.error(`No phone number for CHEW ${chew._id}`);
      return;
    }

    const message = `⚠️ ALERT: Patient ${pregnancy.womanId?.name || "Unknown"} (${pregnancy.womanId?.phone}) has missed ANC visit for week ${visit.weekNumber}. ${daysLate} days overdue. Please follow up immediately.`;

    await MessagingService.queueMessage({
      to: chewPhone,
      content: message,
      language: "en",
      type: "missed_visit_escalation",
      priority: "high",
      metadata: {
        pregnancyId: pregnancy._id,
        visitWeek: visit.weekNumber,
        missedDays: daysLate,
        escalationLevel: 1,
        type: "chew_escalation",
      },
    });

    await this.updateMissedVisitRecord(pregnancy._id, visit, {
      chewNotified: true,
      chewNotifiedAt: new Date(),
    });
    logger.info(
      `Missed visit escalated to CHEW for pregnancy ${pregnancy._id}`,
    );
  }

  /**
   * Escalate missed visit to supervisor
   */
  async escalateToSupervisor(pregnancy, visit, daysLate) {
    const supervisor = await this.getSupervisor(pregnancy.chewId);

    const hasSupervisor = supervisor?.phone;
    if (!hasSupervisor) {
      logger.error(`No supervisor found for CHEW ${pregnancy.chewId?._id}`);
      return;
    }

    const message = `🚨 URGENT: Patient under CHEW ${pregnancy.chewId?.phcName || "Unknown PHC"} has missed ANC visit for ${daysLate} days. Patient: ${pregnancy.womanId?.name} (${pregnancy.womanId?.phone}). Week ${visit.weekNumber}. Required: Immediate follow-up action.`;

    await MessagingService.queueMessage({
      to: supervisor.phone,
      content: message,
      language: "en",
      type: "missed_visit_supervisor_escalation",
      priority: "high",
      metadata: {
        pregnancyId: pregnancy._id,
        chewId: pregnancy.chewId?._id,
        visitWeek: visit.weekNumber,
        missedDays: daysLate,
        escalationLevel: 2,
        type: "supervisor_escalation",
      },
    });

    await this.updateMissedVisitRecord(pregnancy._id, visit, {
      supervisorNotified: true,
      supervisorNotifiedAt: new Date(),
    });
    logger.info(
      `Missed visit escalated to supervisor for pregnancy ${pregnancy._id}`,
    );
  }

  /**
   * Critical escalation for severely missed visits
   */
  async criticalEscalation(pregnancy, visit, daysLate) {
    // Log critical event
    await SystemEvent.create({
      type: "CRITICAL_MISSED_VISIT",
      severity: "CRITICAL",
      message: `Patient has missed ANC visit for ${daysLate} days - Critical escalation required`,
      details: {
        pregnancyId: pregnancy._id,
        womanId: pregnancy.womanId?._id,
        womanName: pregnancy.womanId?.name,
        womanPhone: pregnancy.womanId?.phone,
        chewId: pregnancy.chewId?._id,
        visitWeek: visit.weekNumber,
        daysLate: daysLate,
        scheduledDate: visit.scheduledDate,
      },
    });

    // Send SMS to both CHEW and woman with urgent tone
    const urgentMessage = `🚨 CRITICAL: ${pregnancy.womanId?.name || "Patient"} has missed ANC visit for ${daysLate} days. This is a serious risk to maternal health. IMMEDIATE ACTION REQUIRED.`;

    if (pregnancy.chewId?.phone) {
      await MessagingService.queueMessage({
        to: pregnancy.chewId.phone,
        content: urgentMessage,
        language: "en",
        type: "critical_alert",
        priority: "high",
        metadata: {
          pregnancyId: pregnancy._id,
          type: "critical_missed_visit",
        },
      });
    }

    // Also send to woman with stronger language
    const womanMessage = `🚨 URGENT: You have missed your ANC appointment by ${daysLate} days. Please go to ${pregnancy.clinicName || "your clinic"} TODAY. This is important for your baby's health and yours.`;

    await MessagingService.queueMessage({
      to: pregnancy.womanId.phone,
      content: womanMessage,
      language: pregnancy.womanId?.preferredLanguage || "en",
      type: "critical_alert",
      priority: "high",
      metadata: {
        pregnancyId: pregnancy._id,
        type: "critical_missed_visit_woman",
      },
    });
  }

  async getSupervisor(chew) {
    if (!chew) return null;

    if (chew.supervisorId) {
      return await User.findById(chew.supervisorId);
    }

    return await User.findOne({
      role: "supervisor",
      "address.lga": chew.lga,
      "address.state": chew.state,
    });
  }

  async updateMissedVisitRecord(pregnancyId, visit, updates) {
    const ancPregnancy = await ANCPregnancy.findOne({ pregnancyId });
    if (!ancPregnancy) return;

    const missedRecord = ancPregnancy.missedVisits.find(
      (m) =>
        m.weekNumber === visit.weekNumber &&
        m.milestoneNumber === visit.milestoneNumber,
    );

    if (missedRecord) {
      Object.assign(missedRecord, updates);
      await ancPregnancy.save();
    }
  }

  /**
   * Get missed visit statistics for reporting
   */
  async getMissedVisitStats(chewId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const pregnancies = await Pregnancy.find({
      chewId: chewId,
      status: "active",
    });

    const stats = await this.aggregateMissedVisitStats(pregnancies, startDate);
    return this.calculateStatistics(stats, pregnancies.length);
  }

  /**
   * Aggregate missed visit data from all pregnancies
   * @private
   */
  async aggregateMissedVisitStats(pregnancies, startDate) {
    const stats = {
      totalMissed: 0,
      totalEscalations: 0,
      resolvedMissed: 0,
    };

    for (const pregnancy of pregnancies) {
      const ancPregnancy = await ANCPregnancy.findOne({
        pregnancyId: pregnancy._id,
      });
      if (!ancPregnancy) continue;

      const recentMissed = ancPregnancy.missedVisits.filter(
        (m) => m.missedDate >= startDate,
      );
      stats.totalMissed += recentMissed.length;
      stats.totalEscalations += recentMissed.filter(
        (m) => m.escalationLevel > 0,
      ).length;
      stats.resolvedMissed += recentMissed.filter((m) => m.resolved).length;
    }

    return stats;
  }

  /**
   * Calculate final statistics from aggregated data
   * @private
   */
  calculateStatistics(stats, pregnancyCount) {
    const resolutionRate =
      stats.totalMissed > 0
        ? (stats.resolvedMissed / stats.totalMissed) * 100
        : 100;

    const averageMissedPerWoman =
      pregnancyCount > 0 ? stats.totalMissed / pregnancyCount : 0;

    return {
      totalMissed: stats.totalMissed,
      totalEscalations: stats.totalEscalations,
      resolvedMissed: stats.resolvedMissed,
      resolutionRate,
      averageMissedPerWoman,
    };
  }

  /**
   * Manually mark a missed visit as resolved
   */
  async resolveMissedVisit(
    pregnancyId,
    weekNumber,
    milestoneNumber,
    resolutionNotes,
  ) {
    const ancPregnancy = await ANCPregnancy.findOne({ pregnancyId });
    if (!ancPregnancy) {
      throw new Error("ANC pregnancy record not found");
    }

    const missedRecord = ancPregnancy.missedVisits.find(
      (m) =>
        m.weekNumber === weekNumber && m.milestoneNumber === milestoneNumber,
    );

    if (!missedRecord) {
      throw new Error("Missed visit record not found");
    }

    missedRecord.resolved = true;
    missedRecord.resolvedAt = new Date();
    missedRecord.resolutionNotes = resolutionNotes;

    // Also mark the original visit as resolved
    const visit = ancPregnancy.fmohSchedule.find(
      (v) =>
        v.weekNumber === weekNumber && v.milestoneNumber === milestoneNumber,
    );
    if (visit) {
      visit.missedResolved = true;
      visit.missedResolvedAt = new Date();
    }

    await ancPregnancy.save();

    logger.info(
      `Missed visit resolved: Pregnancy ${pregnancyId}, Week ${weekNumber}`,
    );

    return { success: true, missedRecord };
  }
}

export default new MissedVisitTracker();
