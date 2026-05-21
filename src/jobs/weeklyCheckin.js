import cron from "node-cron";
import Pregnancy from "../models/Pregnancy.js";
import MessageQueue from "../models/MessageQueue.js";
import MessagingService from "../services/messagingService.js";
import SystemEvent from "../models/SystemEvent.js";
import logger from "../utils/logger.js";
import DangerReport from "../models/DangerReport.js";

class WeeklyCheckinScheduler {
  constructor() {
    this.checkinWindow = {
      startHour: 8, // 8 AM
      endHour: 20, // 8 PM
    };
    this.reminderThreshold = 24; // hours before sending reminder
  }

  /**
   * Start the weekly check-in scheduler
   * Runs every day at 8:00 AM to send check-ins for that day's cohort
   */
  start() {
    // Run daily at 8:00 AM WAT (7:00 AM UTC)
    const schedule = "0 7 * * *";

    cron.schedule(schedule, async () => {
      await this.processWeeklyCheckins();
    });

    // Also run a recovery job at 2:00 PM for missed check-ins
    const recoverySchedule = "0 13 * * *";
    cron.schedule(recoverySchedule, async () => {
      await this.recoverMissedCheckins();
    });

    logger.info(
      "Weekly check-in scheduler started - running daily at 8:00 AM and 2:00 PM WAT",
    );
  }

  /**
   * Process weekly check-ins for all eligible women
   */
  async processWeeklyCheckins() {
    if (this.isRunning) {
      logger.warn("Weekly check-in processor already running, skipping");
      return;
    }

    this.isRunning = true;
    logger.info("Starting weekly check-in processing...");

    try {
      // Get all active pregnancies
      const pregnancies = await Pregnancy.find({
        status: "active",
        gestationalWeek: { $gte: 8, $lte: 42 },
      }).populate("womanId");

      let checkinsSent = 0;
      let errors = 0;
      let skipped = 0;

      for (const pregnancy of pregnancies) {
        try {
          const shouldSend = await this.shouldSendCheckin(pregnancy);

          if (shouldSend) {
            await this.sendWeeklyCheckin(pregnancy);
            checkinsSent++;

            // Update last checkin date
            pregnancy.lastCheckin = new Date();
            await pregnancy.save();
          } else {
            skipped++;
          }
        } catch (error) {
          errors++;
          logger.error(
            `Failed to send check-in for pregnancy ${pregnancy._id}:`,
            error,
          );
        }
      }

      logger.info(
        `Weekly check-in completed: ${checkinsSent} sent, ${skipped} skipped, ${errors} errors`,
      );

      // Log metrics
      let severity;
      if (errors > 10) {
        severity = "HIGH";
      } else if (errors > 0) {
        severity = "MEDIUM";
      } else {
        severity = "LOW";
      }
      await SystemEvent.create({
        type: "WEEKLY_CHECKIN",
        severity,
        message: `Weekly check-in processing completed`,
        details: {
          checkinsSent,
          skipped,
          errors,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      logger.error("Weekly check-in processing failed:", error);

      await SystemEvent.create({
        type: "SCHEDULER_FAILURE",
        severity: "CRITICAL",
        message: "Weekly check-in scheduler failed",
        details: {
          error: error.message,
          stack: error.stack,
        },
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Determine if a woman should receive a check-in today
   */
  async shouldSendCheckin(pregnancy) {
    // Check if already sent a check-in in the last 7 days
    if (pregnancy.lastCheckin) {
      const daysSinceLastCheckin =
        (Date.now() - pregnancy.lastCheckin) / (1000 * 60 * 60 * 24);
      if (daysSinceLastCheckin < 6) {
        return false;
      }
    }

    // Don't send during night hours (respect cultural norms)
    const currentHour = new Date().getHours();
    if (
      currentHour < this.checkinWindow.startHour ||
      currentHour > this.checkinWindow.endHour
    ) {
      return false;
    }

    // Don't send to women who have opted out
    if (pregnancy.womanId?.optOut?.isOptedOut) {
      return false;
    }

    // Don't send if woman has active RED flag (they need immediate care, not check-in)
    const activeRedFlag = await this.hasActiveRedFlag(pregnancy._id);
    if (activeRedFlag) {
      logger.info(
        `Skipping check-in for ${pregnancy._id} - has active RED flag`,
      );
      return false;
    }

    return true;
  }

  /**
   * Send weekly check-in SMS
   */
  async sendWeeklyCheckin(pregnancy) {
    const language = pregnancy.womanId?.preferredLanguage || "en";
    const week = pregnancy.gestationalWeek;
    const name = pregnancy.womanId?.name?.split(" ")[0] || "Mama";

    // Symptom check-in message templates by language
    const templates = {
      en: `Hello ${name}, you are ${week} weeks pregnant. How are you feeling? Reply with the number for any symptom you have:\n\n1-Heavy bleeding\n2-Severe headache\n3-Swollen face/hands\n4-Blurry vision\n5-Fever\n6-Reduced baby movement\n7-Severe abdominal pain\n8-Convulsion\n0-No symptoms\n\nReply with numbers separated by commas (e.g., 1,5). MamaCheck is a safety guide.`,

      pidgin: `Hello ${name}, you dey ${week} weeks pregnant. How body? Reply with number for any symptom wey you get:\n\n1-Heavy bleeding\n2-Serious headache\n3-Swollen face/hand\n4-Eye no see well\n5-Fever\n6-Pikin no dey move well\n7-Serious belle pain\n8-Fainting/Convulsion\n0-No problem - I dey fine\n\nReply with numbers join with comma (e.g., 1,5). MamaCheck na guide.`,

      yo: `Bawo ${name}, o loyun ọsẹ ${week}. Bawo ni ara rẹ? Dahun pẹlu nọmba fun eyikeyi aami aisan ti o ni:\n\n1-Ìṣàn ẹ̀jẹ̀ líle\n2-Orí fífọ́ líle\n3-Ojú tàbí ọwọ́ wíwú\n4-Ojú ṣókùnkùn\n5-Iba\n6-Ìṣun ọmọ kéré\n7-Inú ríro líle\n8-Ìpàdánu àìmọ̀kan\n0-Kò sí nkankan\n\nDahun pẹlu awọn nọmba (e.g., 1,5). MamaCheck jẹ itọsọna.`,

      ha: `Sannu ${name}, kina da ciki mako ${week}. Yaya jiki? Amsa da lambar don duk wata alamar da kuke da ita:\n\n1-Zubar jini mai yawa\n2-Ciwon kai mai tsanani\n3-Kumburin fuska/hannu\n4-Ganin da ba a gani ba\n5-Zazzabi\n6-Rage motsin jariri\n7-Ciwan ciki mai tsanani\n8-Mace-fadi\n0-Babu komai - Ina lafiya\n\nAmsa da lambobi (misali, 1,5). MamaCheck jagora ne.`,

      ig: `Ndewo ${name}, ị dị ime izu ${week}. Kedu ahụ́ gị? Zaghachi na nọmba maka ihe mgbaàmà ọ bụla ị nwere:\n\n1-Ọbara na-agbapụta\n2-Isi ọwụwa siri ike\n3-Ọnụ ma ọ bụ aka zaa\n4-Ọhụ̀ ụkọ\n5-Ahụ ọkụ\n6-Mbelata mmegharị nwa\n7-Afọ mgbu siri ike\n8-Ọdụdọ\n0-Ọnweghị - Ahụ́ dị m mma\n\nZaghachi na nọmba (eg, 1,5). MamaCheck bụ ntuziaka nchekwa.`,
    };

    const message = templates[language] || templates.en;

    // Queue the message
    await MessagingService.queueMessage({
      to: pregnancy.womanId.phone,
      content: message,
      language: language,
      type: "weekly_checkin",
      priority: "normal",
      metadata: {
        pregnancyId: pregnancy._id,
        womanId: pregnancy.womanId._id,
        gestationalWeek: week,
        checkinType: "weekly",
      },
    });

    logger.info(
      `Weekly check-in queued for ${pregnancy.womanId.phone}, week ${week}`,
    );

    // Schedule a reminder for tomorrow if no response
    await this.scheduleCheckinReminder(pregnancy);
  }

  /**
   * Schedule a reminder for women who don't respond
   */
  async scheduleCheckinReminder(pregnancy) {
    const reminderTime = new Date();
    reminderTime.setHours(reminderTime.getHours() + this.reminderThreshold);

    const language = pregnancy.womanId?.preferredLanguage || "en";
    const reminderTemplates = {
      en: `Reminder: We haven't heard from you yet. Please reply with the number for any symptoms you're experiencing, or 0 if you're fine. Your health matters, ${pregnancy.womanId?.name?.split(" ")[0] || "Mama"}.`,
      pidgin: `Reminder: We no hear from you yet. Please reply with number for any symptom wey you get, or 0 if you dey fine. Your health important, ${pregnancy.womanId?.name?.split(" ")[0] || "Mama"}.`,
      yo: `Olurannileti: A ko tii gbọ ọ sibẹsibẹ. Jọwọ dahun pẹlu nọmba fun eyikeyi ami aisan ti o ni iriri, tabi 0 ti o ba dara. Ilera rẹ ṣe pataki, ${pregnancy.womanId?.name?.split(" ")[0] || "Mama"}.`,
      ha: `Tunatarwa: Ba mu ji daga gare ku ba tukuna. Da fatan za a amsa da lamba don duk wata alamar da kuke fuskanta, ko 0 idan kuna lafiya. Lafiyar ku tana da mahimmanci, ${pregnancy.womanId?.name?.split(" ")[0] || "Mama"}.`,
      ig: `Ihe ncheta: Anyị anụbeghị gị. Biko zaghachi na nọmba maka ihe mgbaàmà ọ bụla ị na-enwe, ma ọ bụ 0 ma ọ bụrụ na ahụ́ dị gị mma. Ahụ́ike gị dị mkpa, ${pregnancy.womanId?.name?.split(" ")[0] || "Mama"}.`,
    };

    const reminderMessage = reminderTemplates[language] || reminderTemplates.en;

    await MessagingService.queueMessage({
      to: pregnancy.womanId.phone,
      content: reminderMessage,
      language: language,
      type: "checkin_reminder",
      priority: "normal",
      scheduledFor: reminderTime,
      metadata: {
        pregnancyId: pregnancy._id,
        womanId: pregnancy.womanId._id,
        reminderType: "no_response",
      },
    });
  }

  /**
   * Recover missed check-ins (women who didn't receive due to technical issues)
   */
  async recoverMissedCheckins() {
    logger.info("Running missed check-in recovery...");

    try {
      // Find women who should have received a check-in but didn't
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

      let recovered = 0;

      for (const pregnancy of pregnancies) {
        // Check if any check-in was sent in the last 7 days
        const recentCheckin = await MessageQueue.findOne({
          "metadata.pregnancyId": pregnancy._id,
          type: "weekly_checkin",
          createdAt: { $gte: sevenDaysAgo },
        });

        if (!recentCheckin) {
          await this.sendWeeklyCheckin(pregnancy);
          recovered++;
          logger.info(`Recovered missed check-in for ${pregnancy._id}`);
        }
      }

      if (recovered > 0) {
        logger.info(
          `Missed check-in recovery completed: ${recovered} check-ins sent`,
        );
      }
    } catch (error) {
      logger.error("Missed check-in recovery failed:", error);
    }
  }

  /**
   * Check if pregnancy has active RED flag
   */
  async hasActiveRedFlag(pregnancyId) {
    const activeRedFlag = await DangerReport.findOne({
      pregnancyId: pregnancyId,
      triageOutcome: "RED",
      "followup.status": { $in: ["pending", "in_progress"] },
    });

    return !!activeRedFlag;
  }

  /**
   * Get check-in response statistics for a CHEW
   */
  async getCheckinStats(chewId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const pregnancies = await Pregnancy.find({ chewId: chewId });
    const pregnancyIds = pregnancies.map((p) => p._id);

    const checkinsSent = await MessageQueue.countDocuments({
      "metadata.pregnancyId": { $in: pregnancyIds },
      type: "weekly_checkin",
      createdAt: { $gte: startDate },
    });

    const responsesReceived = await MessageQueue.countDocuments({
      "metadata.pregnancyId": { $in: pregnancyIds },
      type: "checkin_response",
      createdAt: { $gte: startDate },
    });

    let responseRate;
    if (checkinsSent > 0) {
      responseRate = (responsesReceived / checkinsSent) * 100;
    } else {
      responseRate = 0;
    }

    // Get symptom frequency
    const symptoms = await DangerReport.aggregate([
      {
        $match: {
          pregnancyId: { $in: pregnancyIds },
          timestamp: { $gte: startDate },
        },
      },
      { $unwind: "$reportedSymptoms" },
      { $group: { _id: "$reportedSymptoms", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    return {
      checkinsSent,
      responsesReceived,
      responseRate: Math.round(responseRate),
      topSymptoms: symptoms.slice(0, 5).map((s) => ({
        symptomCode: s._id,
        symptomName: this.getSymptomName(s._id),
        count: s.count,
      })),
      averageResponseTime: await this.getAverageResponseTime(
        pregnancyIds,
        startDate,
      ),
    };
  }

  /**
   * Get average response time to check-ins
   */
  async getAverageResponseTime(pregnancyIds, startDate) {
    const responses = await MessageQueue.find({
      "metadata.pregnancyId": { $in: pregnancyIds },
      type: "checkin_response",
      createdAt: { $gte: startDate },
    }).populate("metadata.checkinMessageId");

    if (responses.length === 0) return null;

    let totalResponseTime = 0;
    let validResponses = 0;

    for (const response of responses) {
      if (response.metadata?.checkinMessageId) {
        const checkin = await MessageQueue.findById(
          response.metadata.checkinMessageId,
        );
        if (checkin) {
          const responseTime =
            (response.createdAt - checkin.createdAt) / (1000 * 60 * 60);
          totalResponseTime += responseTime;
          validResponses++;
        }
      }
    }

    let averageResponseTime;
    if (validResponses > 0) {
      averageResponseTime = totalResponseTime / validResponses;
    } else {
      averageResponseTime = null;
    }
    return averageResponseTime;
  }

  getSymptomName(symptomCode) {
    const symptoms = {
      1: "Heavy bleeding",
      2: "Severe headache",
      3: "Swollen face/hands",
      4: "Blurry vision",
      5: "Fever",
      6: "Reduced baby movement",
      7: "Severe abdominal pain",
      8: "Convulsion",
      0: "No symptoms",
    };
    return symptoms[symptomCode] || "Unknown";
  }
  isRunning = false;
}

export default new WeeklyCheckinScheduler();
