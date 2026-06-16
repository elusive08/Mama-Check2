import mongoose from "mongoose";
import Pregnancy from "../models/Pregnancy.js";
import ANCPregnancy from "../models/ANCPregnancy.js";
import CHEWProfile from "../models/CHEWProfile.js";
import User from "../models/User.js";
import GestationalAgeService from "../utils/gestationalAge.js";

class PregnancyService {
  async registerPregnancy(data) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Create or get user
      let woman = await User.findOne({ phone: data.phone });
      if (!woman) {
        woman = new User({
          name: data.name,
          phone: data.phone,
          address: data.address,
          preferredLanguage: data.preferredLanguage,
          trustedContact: data.trustedContact,
          consent: { sms: true, dataProcessing: true, consentDate: new Date() },
        });
        await woman.save({ session });
      }

      // Calculate gestational age
      const ga = GestationalAgeService.calculateGestationalAge(
        data.lmp,
        data.edd,
      );

      // Fetch CHEWProfile to get phcId
      const chewProfile = await CHEWProfile.findById(data.chewId);

      // Create pregnancy record
      const pregnancy = new Pregnancy({
        womanId: woman._id,
        chewId: data.chewId,
        phcId: chewProfile?.phcId || data.phcId || "UNKNOWN",
        lmp: data.lmp || ga.lmp,
        edd: data.edd || ga.edd,
        gestationalWeek: ga.weeks,
        clinicName: data.clinicName || chewProfile?.phcName,
        clinicId: data.clinicId,
        parity: data.parity,
        gravida: data.gravida,
        registrationDate: new Date(),
        status: "active",
      });
      await pregnancy.save({ session });

      // Create ANC tracking
      const ancPregnancy = new ANCPregnancy({
        pregnancyId: pregnancy._id,
        fmohSchedule: this.generateFMOHSchedule(pregnancy.lmp),
      });
      await ancPregnancy.save({ session });

      await session.commitTransaction();

      return { pregnancy, woman, ancPregnancy };
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  }

  generateFMOHSchedule(lmp) {
    const schedule = [];
    const milestones = [
      { week: 8, number: 1, desc: "First ANC - Registration & baseline" },
      { week: 12, number: 2, desc: "Second ANC - Ultrasound & lab tests" },
      { week: 16, number: 3, desc: "Third ANC - Follow-up assessment" },
      { week: 20, number: 4, desc: "Fourth ANC - Anomaly scan" },
      { week: 24, number: 5, desc: "Fifth ANC - OGTT & immunization" },
      { week: 28, number: 6, desc: "Sixth ANC - Growth scan" },
      { week: 32, number: 7, desc: "Seventh ANC - Presentation check" },
      { week: 36, number: 8, desc: "Eighth ANC - Birth preparedness" },
    ];

    milestones.forEach((milestone) => {
      const milestoneDate = new Date(lmp);
      milestoneDate.setDate(milestoneDate.getDate() + milestone.week * 7);

      schedule.push({
        weekNumber: milestone.week,
        milestoneNumber: milestone.number,
        description: milestone.desc,
        scheduledDate: milestoneDate,
        reminderSent: false,
        reminderDate: null,
        attended: false,
        attendedDate: null,
        notes: "",
      });
    });

    return schedule;
  }

  async updateGestationalAge(pregnancyId) {
    const pregnancy = await Pregnancy.findById(pregnancyId);
    if (!pregnancy) throw new Error("Pregnancy not found");

    const ga = GestationalAgeService.calculateGestationalAge(
      pregnancy.lmp,
      pregnancy.edd,
    );
    pregnancy.gestationalWeek = ga.weeks;
    await pregnancy.save();

    return ga;
  }

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
      const nextVisit = ancPregnancy.fmohSchedule.find(
        (v) => !v.attended && v.scheduledDate <= endDate,
      );

      if (nextVisit) {
        upcoming.push({
          pregnancy,
          visit: nextVisit,
        });
      }
    }

    return upcoming;
  }

  async markVisitAttended(
    pregnancyId,
    milestoneNumber,
    attendedDate = new Date(),
  ) {
    const ancPregnancy = await ANCPregnancy.findOne({ pregnancyId });
    const milestone = ancPregnancy.fmohSchedule.find(
      (m) => m.milestoneNumber === milestoneNumber,
    );

    if (!milestone) throw new Error("Milestone not found");

    milestone.attended = true;
    milestone.attendedDate = attendedDate;
    await ancPregnancy.save();

    // Update pregnancy ANC visits
    const pregnancy = await Pregnancy.findById(pregnancyId);
    pregnancy.ancVisits.push({
      weekNumber: milestone.weekNumber,
      scheduledDate: milestone.scheduledDate,
      attendedDate: attendedDate,
      status: "attended",
    });
    await pregnancy.save();

    return { pregnancy, milestone };
  }
}

export default new PregnancyService();
