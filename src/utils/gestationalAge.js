class GestationalAgeCalculator {
  calculateFromLMP(lmp) {
    const today = new Date();
    const lmpDate = new Date(lmp);
    const diffTime = today - lmpDate;
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    const weeks = Math.floor(diffDays / 7);
    const days = diffDays % 7;

    return {
      weeks: Math.min(weeks, 42),
      days: Math.floor(days),
      trimester: this.getTrimester(weeks),
      edd: this.calculateEDD(lmpDate),
      percentageComplete: Math.min((weeks / 40) * 100, 100),
    };
  }

  calculateFromEDD(edd) {
    const today = new Date();
    const eddDate = new Date(edd);
    const diffTime = eddDate - today;
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    const weeks = 40 - Math.floor(diffDays / 7);

    return {
      weeks: Math.min(Math.max(weeks, 0), 42),
      days: Math.abs(diffDays % 7),
      trimester: this.getTrimester(weeks),
      lmp: this.calculateLMP(eddDate),
      daysRemaining: Math.max(0, Math.floor(diffDays)),
    };
  }

  calculateGestationalAge(lmp, edd) {
    if (lmp) {
      return this.calculateFromLMP(lmp);
    } else if (edd) {
      return this.calculateFromEDD(edd);
    }
    throw new Error("Either LMP or EDD must be provided");
  }

  getTrimester(weeks) {
    if (weeks < 13) return 1;
    if (weeks < 28) return 2;
    return 3;
  }

  calculateEDD(lmp) {
    const edd = new Date(lmp);
    edd.setDate(edd.getDate() + 280); // 40 weeks
    return edd;
  }

  calculateLMP(edd) {
    const lmp = new Date(edd);
    lmp.setDate(lmp.getDate() - 280);
    return lmp;
  }

  calculateLMPFromEDD(edd) {
    return this.calculateLMP(edd);
  }

  getANCMilestone(weeks) {
    const milestones = {
      8: {
        number: 1,
        name: "First ANC Visit",
        description: "Registration and baseline assessment",
      },
      12: {
        number: 2,
        name: "Second ANC Visit",
        description: "Ultrasound and laboratory tests",
      },
      16: {
        number: 3,
        name: "Third ANC Visit",
        description: "Follow-up assessment",
      },
      20: { number: 4, name: "Fourth ANC Visit", description: "Anomaly scan" },
      24: {
        number: 5,
        name: "Fifth ANC Visit",
        description: "OGTT and immunization",
      },
      28: { number: 6, name: "Sixth ANC Visit", description: "Growth scan" },
      32: {
        number: 7,
        name: "Seventh ANC Visit",
        description: "Presentation check",
      },
      36: {
        number: 8,
        name: "Eighth ANC Visit",
        description: "Birth preparedness",
      },
    };
    return milestones[weeks] || null;
  }

  getVisitFrequency(weeks) {
    if (weeks < 28) return { interval: 28, frequency: "monthly" };
    if (weeks < 36) return { interval: 14, frequency: "biweekly" };
    if (weeks <= 40) return { interval: 7, frequency: "weekly" };
    return { interval: 2, frequency: "every_2_days" };
  }
}

export default new GestationalAgeCalculator();
