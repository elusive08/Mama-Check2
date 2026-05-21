import MessageTemplate from "../models/MessageTemplate.js";
import MessageQueue from "../models/MessageQueue.js";
import ANCPregnancy from "../models/ANCPregnancy.js";
import logger from "../utils/logger.js";

class ReminderService {
  constructor() {
    this.reminderTypes = {
      ANC: "anc_reminder",
      FOLLOWUP: "followup_reminder",
      CHECKIN: "checkin_reminder",
      APPOINTMENT: "appointment_reminder",
    };
  }

  /**
   * Send ANC visit reminder to woman
   */
  async sendANCReminder(pregnancy, visit, isFollowup = false) {
    try {
      const language = pregnancy.womanId?.preferredLanguage || "en";
      const daysUntilVisit = Math.ceil(
        (visit.scheduledDate - Date.now()) / (1000 * 60 * 60 * 24),
      );

      // Get template
      const template = await MessageTemplate.findOne({
        type: isFollowup ? "anc_followup_reminder" : "anc_reminder",
        language: language,
        milestoneNumber: visit.milestoneNumber,
        isActive: true,
      });

      let content;
      if (template) {
        content = this.formatTemplate(template.content, {
          name: pregnancy.womanId?.name?.split(" ")[0] || "Mama",
          weeks: pregnancy.gestationalWeek,
          clinic: pregnancy.clinicName || "your clinic",
          milestone: visit.milestoneNumber,
          days: daysUntilVisit,
          date: visit.scheduledDate.toLocaleDateString(),
        });
      } else {
        // Fallback template
        content = this.getFallbackReminder(
          language,
          pregnancy,
          visit,
          isFollowup,
        );
      }

      // Queue the message
      const message = await MessageQueue.create({
        to: pregnancy.womanId.phone,
        content: content,
        language: language,
        type: isFollowup ? "followup_reminder" : "reminder",
        priority: isFollowup ? "high" : "normal",
        scheduledFor: new Date(),
        metadata: {
          pregnancyId: pregnancy._id,
          womanId: pregnancy.womanId._id,
          milestoneNumber: visit.milestoneNumber,
          visitWeek: visit.weekNumber,
          reminderType: isFollowup ? "followup" : "initial",
          daysUntilVisit: daysUntilVisit,
        },
      });

      // Update reminder sent flag
      visit.reminderSent = true;
      visit.reminderDate = new Date();
      if (isFollowup) {
        visit.followupSent = true;
        visit.followupDate = new Date();
      }

      await ANCPregnancy.updateOne(
        { pregnancyId: pregnancy._id },
        {
          $set: {
            [`fmohSchedule.${visit.milestoneNumber - 1}.reminderSent`]: true,
          },
        },
      );

      logger.info(
        `ANC reminder sent to ${pregnancy.womanId.phone} for week ${visit.weekNumber}`,
      );

      return message;
    } catch (error) {
      logger.error("Failed to send ANC reminder:", error);
      throw error;
    }
  }

  /**
   * Send reminder to trusted contact
   */
  async sendTrustedReminder(pregnancy, visit) {
    try {
      const trustedContact = pregnancy.womanId?.trustedContact;
      if (!trustedContact?.phone) {
        logger.info(`No trusted contact for pregnancy ${pregnancy._id}`);
        return null;
      }

      const language =
        trustedContact.preferredLanguage ||
        pregnancy.womanId?.preferredLanguage ||
        "en";
      const daysUntilVisit = Math.ceil(
        (visit.scheduledDate - Date.now()) / (1000 * 60 * 60 * 24),
      );

      const template = await MessageTemplate.findOne({
        type: "trusted_reminder",
        language: language,
        isActive: true,
      });

      let content;
      if (template) {
        content = this.formatTemplate(template.content, {
          womanName: pregnancy.womanId?.name,
          relationship: trustedContact.relationship || "family member",
          clinic: pregnancy.clinicName || "her clinic",
          weeks: pregnancy.gestationalWeek,
          days: daysUntilVisit,
          date: visit.scheduledDate.toLocaleDateString(),
        });
      } else {
        content = `Hello, this is MamaCheck. ${pregnancy.womanId?.name} (${trustedContact.relationship}) has an ANC visit scheduled in ${daysUntilVisit} days at ${pregnancy.clinicName || "her clinic"}. Please support her to attend. Thank you.`;
      }

      const message = await MessageQueue.create({
        to: trustedContact.phone,
        content: content,
        language: language,
        type: "trusted_reminder",
        priority: "normal",
        scheduledFor: new Date(),
        metadata: {
          pregnancyId: pregnancy._id,
          womanId: pregnancy.womanId._id,
          relationship: trustedContact.relationship,
          reminderType: "trusted_support",
        },
      });

      logger.info(
        `Trusted reminder sent to ${trustedContact.phone} for ${pregnancy.womanId?.name}`,
      );

      return message;
    } catch (error) {
      logger.error("Failed to send trusted reminder:", error);
      return null;
    }
  }

  /**
   * Send follow-up reminder for missed response
   */
  async sendFollowupReminder(pregnancy, context) {
    try {
      const language = pregnancy.womanId?.preferredLanguage || "en";
      const reminderType = context.type || "general";

      const templates = {
        missed_checkin: {
          en: `Reminder: We haven't heard from you this week. Please reply with 0 if you're feeling well, or the number for any symptoms. Your health is important to us.`,
          pidgin: `Reminder: We no hear from you this week. Please reply 0 if you dey fine, or number for any symptom. Your health important.`,
        },
        missed_visit: {
          en: `Reminder: You missed your ANC visit scheduled for week ${context.week}. Please visit ${pregnancy.clinicName || "your clinic"} as soon as possible.`,
          pidgin: `Reminder: You miss your ANC visit for week ${context.week}. Please go ${pregnancy.clinicName || "your clinic"} quick quick.`,
        },
        no_response: {
          en: `We haven't received your response. Please reply with any symptoms you're experiencing, or 0 if you're fine. This helps us ensure you receive the care you need.`,
          pidgin: `We no see your reply. Please reply with any symptom wey you get, or 0 if you dey fine. This help us take care of you.`,
        },
      };

      const content =
        templates[reminderType]?.[language] ||
        templates.missed_checkin[language] ||
        templates.missed_checkin.en;

      const message = await MessageQueue.create({
        to: pregnancy.womanId.phone,
        content: content,
        language: language,
        type: "followup_reminder",
        priority: "high",
        scheduledFor: new Date(Date.now() + 60 * 60 * 1000), // Send in 1 hour
        metadata: {
          pregnancyId: pregnancy._id,
          womanId: pregnancy.womanId._id,
          reminderType: reminderType,
          context: context,
        },
      });

      logger.info(
        `Followup reminder queued for ${pregnancy.womanId.phone} - type: ${reminderType}`,
      );

      return message;
    } catch (error) {
      logger.error("Failed to send followup reminder:", error);
      throw error;
    }
  }

  /**
   * Send appointment reminder for next visit
   */
  async sendAppointmentReminder(pregnancy) {
    try {
      const ancPregnancy = await ANCPregnancy.findOne({
        pregnancyId: pregnancy._id,
      });
      if (!ancPregnancy) return null;

      const nextVisit = ancPregnancy.fmohSchedule.find((v) => !v.attended);
      if (!nextVisit) return null;

      const daysUntilVisit = Math.ceil(
        (nextVisit.scheduledDate - Date.now()) / (1000 * 60 * 60 * 24),
      );

      // Only send if within 3 days
      if (daysUntilVisit > 3) return null;

      const language = pregnancy.womanId?.preferredLanguage || "en";

      const templates = {
        en: `📅 Appointment Reminder: Your ANC visit is scheduled for ${nextVisit.scheduledDate.toLocaleDateString()} (in ${daysUntilVisit} days) at ${pregnancy.clinicName || "your clinic"}. Please come on time. Reply STOP to unsubscribe.`,
        pidgin: `📅 Appointment Reminder: Your ANC visit dey for ${nextVisit.scheduledDate.toLocaleDateString()} (for ${daysUntilVisit} days) for ${pregnancy.clinicName || "your clinic"}. Please come on time.`,
        yo: `📅 Olurannileti Ipinnu: Ibẹwo ANC rẹ ti ṣeto fun ${nextVisit.scheduledDate.toLocaleDateString()} (ni ${daysUntilVisit} ọjọ) ni ${pregnancy.clinicName || "ile-iwosan rẹ"}. Jọwọ wa ni akoko.`,
      };

      const content = templates[language] || templates.en;

      const message = await MessageQueue.create({
        to: pregnancy.womanId.phone,
        content: content,
        language: language,
        type: "appointment_reminder",
        priority: "high",
        scheduledFor: new Date(),
        metadata: {
          pregnancyId: pregnancy._id,
          womanId: pregnancy.womanId._id,
          milestoneNumber: nextVisit.milestoneNumber,
          visitWeek: nextVisit.weekNumber,
          scheduledDate: nextVisit.scheduledDate,
          daysUntil: daysUntilVisit,
        },
      });

      logger.info(
        `Appointment reminder sent for pregnancy ${pregnancy._id}, visit in ${daysUntilVisit} days`,
      );

      return message;
    } catch (error) {
      logger.error("Failed to send appointment reminder:", error);
      return null;
    }
  }

  /**
   * Send batch reminders for multiple pregnancies
   */
  async sendBatchReminders(pregnancies, reminderType, context = {}) {
    const results = {
      total: pregnancies.length,
      successful: 0,
      failed: 0,
      errors: [],
    };

    // Process in batches of 50 to avoid overwhelming the system
    const batchSize = 50;
    for (let i = 0; i < pregnancies.length; i += batchSize) {
      const batch = pregnancies.slice(i, i + batchSize);
      const batchPromises = batch.map(async (pregnancy) => {
        try {
          switch (reminderType) {
            case "anc": {
              const ancPregnancy = await ANCPregnancy.findOne({
                pregnancyId: pregnancy._id,
              });
              const nextVisit = ancPregnancy?.fmohSchedule.find(
                (v) => !v.attended,
              );
              if (nextVisit) {
                await this.sendANCReminder(pregnancy, nextVisit, false);
                results.successful++;
              }
              break;
            }
            case "appointment":
              await this.sendAppointmentReminder(pregnancy);
              results.successful++;
              break;
            case "followup":
              await this.sendFollowupReminder(pregnancy, context);
              results.successful++;
              break;
            default:
              results.failed++;
          }
        } catch (error) {
          results.failed++;
          results.errors.push({
            pregnancyId: pregnancy._id,
            error: error.message,
          });
        }
      });

      await Promise.allSettled(batchPromises);

      // Rate limiting between batches
      if (i + batchSize < pregnancies.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    logger.info(
      `Batch reminders sent: ${results.successful}/${results.total} successful`,
    );
    return results;
  }

  /**
   * Format template with variables
   */
  formatTemplate(template, variables) {
    let message = template;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, "g");
      message = message.replace(regex, value || "");
    }
    // Remove any remaining template variables
    message = message.replace(/{{[^}]+}}/g, "");
    return message;
  }

  /**
   * Get fallback reminder message
   */
  getFallbackReminder(language, pregnancy, visit, isFollowup) {
    const fallbacks = {
      en: `${isFollowup ? "REMINDER: " : ""}Hello ${pregnancy.womanId?.name?.split(" ")[0] || "Mama"}, you are ${pregnancy.gestationalWeek} weeks pregnant. Time for your ANC visit (Visit ${visit.milestoneNumber}) at ${pregnancy.clinicName || "your clinic"}. Please attend this week. MamaCheck is a safety guide.`,
      pidgin: `${isFollowup ? "REMINDER: " : ""}Hello ${pregnancy.womanId?.name?.split(" ")[0] || "Mama"}, you dey ${pregnancy.gestationalWeek} weeks pregnant. Time for your ANC visit (Visit ${visit.milestoneNumber}) for ${pregnancy.clinicName || "your clinic"}. Please come this week. MamaCheck na guide.`,
      yo: `${isFollowup ? "OLURANNILETI: " : ""}Hello ${pregnancy.womanId?.name?.split(" ")[0] || "Mama"}, o loyun ọsẹ ${pregnancy.gestationalWeek}. Akoko fun ibẹwo ANC rẹ (Ibẹwo ${visit.milestoneNumber}) ni ${pregnancy.clinicName || "ile-iwosan rẹ"}. Jọwọ wa ni ọsẹ yii. MamaCheck jẹ itọsọna.`,
    };
    return fallbacks[language] || fallbacks.en;
  }

  /**
   * Cancel pending reminders for a pregnancy
   */
  async cancelReminders(pregnancyId, types = null) {
    const query = {
      "metadata.pregnancyId": pregnancyId,
      status: "queued",
      type: { $in: ["reminder", "followup_reminder", "appointment_reminder"] },
    };

    if (types && Array.isArray(types)) {
      query.type = { $in: types };
    }

    const result = await MessageQueue.updateMany(query, {
      $set: { status: "cancelled", cancelledAt: new Date() },
    });

    logger.info(
      `Cancelled ${result.modifiedCount} reminders for pregnancy ${pregnancyId}`,
    );
    return result.modifiedCount;
  }
}

export default new ReminderService();
