// src/services/gestationalAgeService.js

class GestationalAgeService {
  constructor() {
    // Class constants

    // Constants
    this.FMOH_MILESTONES = [
      {
        week: 8,
        number: 1,
        name: "First ANC Visit",
        description: "Registration and baseline assessment",
        isCritical: true,
      },
      {
        week: 12,
        number: 2,
        name: "Second ANC Visit",
        description: "Ultrasound and laboratory tests",
        isCritical: true,
      },
      {
        week: 16,
        number: 3,
        name: "Third ANC Visit",
        description: "Follow-up assessment",
        isCritical: false,
      },
      {
        week: 20,
        number: 4,
        name: "Fourth ANC Visit",
        description: "Anomaly scan",
        isCritical: true,
      },
      {
        week: 24,
        number: 5,
        name: "Fifth ANC Visit",
        description: "OGTT and immunization",
        isCritical: false,
      },
      {
        week: 28,
        number: 6,
        name: "Sixth ANC Visit",
        description: "Growth scan",
        isCritical: true,
      },
      {
        week: 32,
        number: 7,
        name: "Seventh ANC Visit",
        description: "Presentation check",
        isCritical: false,
      },
      {
        week: 36,
        number: 8,
        name: "Eighth ANC Visit",
        description: "Birth preparedness",
        isCritical: true,
      },
    ];
  }

  /**
   * Calculate gestational age from LMP or EDD with enhanced validation
   * @param {Date|string} lmp - Last menstrual period
   * @param {Date|string} edd - Expected delivery date
   * @param {Object} options - Calculation options
   * @returns {Object} Gestational age details
   */
  calculateGestationalAge(lmp = null, edd = null, options = {}) {
    const { validateDates = true, roundUp = false } = options;

    // Validate input
    if (!lmp && !edd) {
      throw new Error("Either LMP or EDD must be provided");
    }

    // Parse dates if they're strings
    const parsedLMP = lmp ? this.parseDate(lmp) : null;
    const parsedEDD = edd ? this.parseDate(edd) : null;

    // Validate date ranges
    if (validateDates) {
      if (parsedLMP && !this.isValidLMP(parsedLMP)) {
        throw new Error("Invalid LMP date: Must be within the last 42 weeks");
      }
      if (parsedEDD && !this.isValidEDD(parsedEDD)) {
        throw new Error("Invalid EDD date: Must be within the next 42 weeks");
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (parsedLMP) {
      return this.calculateFromLMP(parsedLMP, today, roundUp);
    }

    if (parsedEDD) {
      return this.calculateFromEDD(parsedEDD, today, roundUp);
    }

    throw new Error("Either LMP or EDD must be provided");
  }

  /**
   * Calculate gestational age from LMP
   * @param {Date} lmp - Last menstrual period date
   * @param {Date} today - Current date
   * @param {boolean} roundUp - Whether to round up days to weeks
   * @returns {Object} Gestational age details
   */
  calculateFromLMP(lmp, today, roundUp = false) {
    const diffTime = today - lmp;
    const diffDays = diffTime / (1000 * 60 * 60 * 24);

    let weeks = Math.floor(diffDays / 7);
    let days = diffDays % 7;

    // Round up if requested and days >= 4 (clinical rounding)
    if (roundUp && days >= 4) {
      weeks += 1;
      days = 0;
    } else {
      days = Math.floor(days);
    }

    // Clamp to valid ranges
    weeks = Math.min(
      Math.max(weeks, this.MIN_GESTATIONAL_WEEKS),
      this.MAX_GESTATIONAL_WEEKS,
    );

    const edd = this.calculateEDD(lmp);
    const conceptionDate = this.calculateConceptionDate(lmp);
    const quickeningDate = this.calculateQuickeningDate(weeks);

    return {
      weeks,
      days,
      totalDays: Math.floor(diffDays),
      trimester: this.getTrimester(weeks),
      percentageComplete: Math.min((weeks / 40) * 100, 100),
      edd,
      lmp,
      conceptionDate,
      quickeningDate,
      weeksRemaining: Math.max(40 - weeks, 0),
      daysRemaining: Math.max(40 * 7 - Math.floor(diffDays), 0),
      isEarlyTerm: weeks >= 37 && weeks < 39,
      isFullTerm: weeks >= 39 && weeks <= 40,
      isLateTerm: weeks === 41,
      isPostTerm: weeks >= 42,
      clinicalAdvice: this.getClinicalAdvice(weeks),
    };
  }

  /**
   * Calculate gestational age from EDD
   * @param {Date} edd - Expected delivery date
   * @param {Date} today - Current date
   * @param {boolean} roundUp - Whether to round up days to weeks
   * @returns {Object} Gestational age details
   */
  calculateFromEDD(edd, today, roundUp = false) {
    const diffTime = edd - today;
    const diffDays = diffTime / (1000 * 60 * 60 * 24);

    let weeks = 40 - Math.floor(diffDays / 7);
    let days = Math.abs(diffDays % 7);

    // Round up if requested
    if (roundUp && days >= 4) {
      weeks += 1;
      days = 0;
    } else {
      days = Math.floor(days);
    }

    // Clamp to valid ranges
    weeks = Math.min(
      Math.max(weeks, this.MIN_GESTATIONAL_WEEKS),
      this.MAX_GESTATIONAL_WEEKS,
    );

    const lmp = this.calculateLMP(edd);
    const conceptionDate = this.calculateConceptionDate(lmp);
    const quickeningDate = this.calculateQuickeningDate(weeks);

    return {
      weeks,
      days,
      totalDays: 40 * 7 - Math.floor(diffDays),
      trimester: this.getTrimester(weeks),
      percentageComplete: Math.min(((40 - diffDays / 7) / 40) * 100, 100),
      edd,
      lmp,
      conceptionDate,
      quickeningDate,
      weeksRemaining: Math.max(Math.ceil(diffDays / 7), 0),
      daysRemaining: Math.max(Math.floor(diffDays), 0),
      isEarlyTerm: weeks >= 37 && weeks < 39,
      isFullTerm: weeks >= 39 && weeks <= 40,
      isLateTerm: weeks === 41,
      isPostTerm: weeks >= 42,
      clinicalAdvice: this.getClinicalAdvice(weeks),
    };
  }

  /**
   * Get trimester based on weeks
   * @param {number} weeks - Gestational weeks
   * @returns {number} Trimester (1, 2, or 3)
   */
  getTrimester(weeks) {
    if (weeks < 13) return 1;
    if (weeks < 28) return 2;
    return 3;
  }

  /**
   * Calculate EDD from LMP (Naegele's rule)
   * @param {Date} lmp - Last menstrual period
   * @returns {Date} Expected delivery date
   */
  calculateEDD(lmp) {
    const edd = new Date(lmp);
    edd.setDate(edd.getDate() + this.STANDARD_PREGNANCY_DAYS);
    return edd;
  }

  /**
   * Calculate LMP from EDD
   * @param {Date} edd - Expected delivery date
   * @returns {Date} Last menstrual period
   */
  calculateLMP(edd) {
    const lmp = new Date(edd);
    lmp.setDate(lmp.getDate() - this.STANDARD_PREGNANCY_DAYS);
    return lmp;
  }

  /**
   * Calculate conception date (approximately 14 days after LMP)
   * @param {Date} lmp - Last menstrual period
   * @returns {Date} Estimated conception date
   */
  calculateConceptionDate(lmp) {
    const conception = new Date(lmp);
    conception.setDate(conception.getDate() + 14);
    return conception;
  }

  /**
   * Calculate quickening date (when mother feels first movements)
   * @param {number} weeks - Current gestational weeks
   * @returns {Date|null} Estimated quickening date
   */
  calculateQuickeningDate(weeks) {
    if (weeks < 16) return null;
    const today = new Date();
    const quickening = new Date(today);
    // For primigravida: 18-20 weeks, for multigravida: 16-18 weeks
    quickening.setDate(quickening.getDate() - (weeks - 18) * 7);
    return quickening;
  }

  /**
   * Get FMOH ANC milestone for given week
   * @param {number} week - Gestational week
   * @returns {Object|null} Milestone or null
   */
  getANCMilestone(week) {
    // Find the milestone for the exact week
    const exactMilestone = this.FMOH_MILESTONES.find((m) => m.week === week);
    if (exactMilestone) return exactMilestone;

    // Find the nearest upcoming milestone
    const upcomingMilestone = this.FMOH_MILESTONES.find((m) => m.week > week);
    if (upcomingMilestone) {
      return {
        ...upcomingMilestone,
        isUpcoming: true,
        weeksUntil: upcomingMilestone.week - week,
      };
    }

    return null;
  }

  /**
   * Get all upcoming ANC milestones
   * @param {number} currentWeek - Current gestational week
   * @returns {Array} List of upcoming milestones
   */
  getUpcomingMilestones(currentWeek) {
    return this.FMOH_MILESTONES.filter((m) => m.week > currentWeek).map(
      (m) => ({
        ...m,
        weeksUntil: m.week - currentWeek,
        estimatedDate: this.addWeeks(new Date(), m.week - currentWeek),
      }),
    );
  }

  /**
   * Get completed ANC milestones
   * @param {number} currentWeek - Current gestational week
   * @returns {Array} List of completed milestones
   */
  getCompletedMilestones(currentWeek) {
    return this.FMOH_MILESTONES.filter((m) => m.week <= currentWeek).map(
      (m) => ({
        ...m,
        wasCompleted: true,
        completedAtWeek: m.week,
      }),
    );
  }

  /**
   * Determine visit frequency based on gestational week
   * @param {number} week - Current gestational week
   * @returns {Object} Visit frequency details
   */
  getVisitFrequency(week) {
    if (week < 28) {
      return {
        frequency: "monthly",
        intervalDays: 28,
        nextVisitInDays: 28 - (week % 4),
        description: "Monthly visits for first and second trimester",
      };
    }
    if (week < 36) {
      return {
        frequency: "biweekly",
        intervalDays: 14,
        nextVisitInDays: 14 - (week % 2),
        description: "Bi-weekly visits for early third trimester",
      };
    }
    if (week <= 40) {
      return {
        frequency: "weekly",
        intervalDays: 7,
        nextVisitInDays: 7,
        description: "Weekly visits for late third trimester",
      };
    }
    return {
      frequency: "every_2_3_days",
      intervalDays: 2,
      nextVisitInDays: 2,
      description: "Frequent monitoring for post-term pregnancy",
    };
  }

  /**
   * Get clinical advice based on gestational week
   * @param {number} weeks - Gestational weeks
   * @returns {Object} Clinical advice
   */
  getClinicalAdvice(weeks) {
    if (weeks < 12) {
      return {
        category: "early_pregnancy",
        message: "Schedule first ANC visit. Start folic acid supplementation.",
        urgentActions: ["Confirm pregnancy", "Begin prenatal vitamins"],
        nextSteps: ["Complete registration", "Schedule ultrasound"],
      };
    }
    if (weeks < 24) {
      return {
        category: "mid_pregnancy",
        message: "Continue regular ANC visits. Monitor fetal movements.",
        urgentActions: ["Complete anomaly scan", "Get OGTT test"],
        nextSteps: ["Track weight gain", "Monitor blood pressure"],
      };
    }
    if (weeks < 36) {
      return {
        category: "late_pregnancy",
        message: "Prepare for delivery. Watch for warning signs.",
        urgentActions: ["Attend growth scan", "Get Tdap vaccine"],
        nextSteps: ["Birth planning", "Hospital bag preparation"],
      };
    }
    if (weeks <= 40) {
      return {
        category: "term",
        message: "Ready for delivery. Monitor labor signs closely.",
        urgentActions: ["Watch for contractions", "Track fetal movements"],
        nextSteps: ["Contact health facility", "Prepare for hospital"],
      };
    }
    return {
      category: "post_term",
      message: "Post-term pregnancy. Immediate medical attention required.",
      urgentActions: ["Go to hospital immediately", "Induction likely needed"],
      nextSteps: ["Frequent monitoring", "Prepare for delivery"],
    };
  }

  /**
   * Validate LMP date
   * @param {Date} lmp - Last menstrual period
   * @returns {boolean} True if valid
   */
  isValidLMP(lmp) {
    const today = new Date();
    const daysSinceLMP = (today - lmp) / (1000 * 60 * 60 * 24);
    return daysSinceLMP >= 0 && daysSinceLMP <= 294; // Up to 42 weeks
  }

  /**
   * Validate EDD date
   * @param {Date} edd - Expected delivery date
   * @returns {boolean} True if valid
   */
  isValidEDD(edd) {
    const today = new Date();
    const daysUntilEDD = (edd - today) / (1000 * 60 * 60 * 24);
    return daysUntilEDD >= -14 && daysUntilEDD <= 294; // From -2 weeks to +42 weeks
  }

  /**
   * Parse date from various formats
   * @param {Date|string} date - Date to parse
   * @returns {Date} Parsed date
   */
  parseDate(date) {
    if (date instanceof Date) return date;
    if (typeof date === "string") {
      const parsed = new Date(date);
      if (Number.isNaN(parsed.getTime())) {
        throw new TypeError(`Invalid date format: ${date}`);
      }
      return parsed;
    }
    throw new Error(`Invalid date type: ${typeof date}`);
  }

  /**
   * Add weeks to a date
   * @param {Date} date - Starting date
   * @param {number} weeks - Number of weeks to add
   * @returns {Date} New date
   */
  addWeeks(date, weeks) {
    const result = new Date(date);
    result.setDate(result.getDate() + weeks * 7);
    return result;
  }

  /**
   * Format gestational age for display
   * @param {Object} ga - Gestational age object
   * @returns {string} Formatted string
   */
  formatGestationalAge(ga) {
    if (ga.days === 0) {
      return `${ga.weeks} weeks`;
    }
    return `${ga.weeks} weeks, ${ga.days} days`;
  }

  /**
   * Get age-appropriate screening recommendations
   * @param {number} weeks - Gestational weeks
   * @returns {Array} Screening recommendations
   */
  getScreeningRecommendations(weeks) {
    const screenings = [];

    if (weeks >= 11 && weeks <= 14) {
      screenings.push({
        test: "Nuchal Translucency Scan",
        purpose: "Down syndrome screening",
        deadline: "14 weeks",
      });
    }

    if (weeks >= 18 && weeks <= 22) {
      screenings.push({
        test: "Anomaly Scan",
        purpose: "Fetal anatomy assessment",
        deadline: "22 weeks",
      });
    }

    if (weeks >= 24 && weeks <= 28) {
      screenings.push({
        test: "Oral Glucose Tolerance Test (OGTT)",
        purpose: "Gestational diabetes screening",
        deadline: "28 weeks",
      });
    }

    if (weeks >= 28 && weeks <= 32) {
      screenings.push({
        test: "Growth Scan",
        purpose: "Fetal growth assessment",
        deadline: "32 weeks",
      });
    }

    if (weeks >= 35 && weeks <= 37) {
      screenings.push({
        test: "Group B Streptococcus",
        purpose: "GBS screening",
        deadline: "37 weeks",
      });
    }

    return screenings;
  }

  /**
   * Compare two gestational ages
   * @param {Object} ga1 - First gestational age
   * @param {Object} ga2 - Second gestational age
   * @returns {number} -1, 0, or 1 for comparison
   */
  compareGestationalAge(ga1, ga2) {
    const totalDays1 = ga1.weeks * 7 + ga1.days;
    const totalDays2 = ga2.weeks * 7 + ga2.days;

    if (totalDays1 < totalDays2) return -1;
    if (totalDays1 > totalDays2) return 1;
    return 0;
  }

  /**
   * Batch calculate gestational ages for multiple pregnancies
   * @param {Array} pregnancies - Array of pregnancy objects with lmp or edd
   * @returns {Array} Enriched pregnancy objects
   */
  batchCalculate(pregnancies) {
    return pregnancies.map((pregnancy) => {
      try {
        const ga = this.calculateGestationalAge(pregnancy.lmp, pregnancy.edd);
        return {
          ...pregnancy,
          gestationalAge: ga,
          milestone: this.getANCMilestone(ga.weeks),
          visitFrequency: this.getVisitFrequency(ga.weeks),
          screenings: this.getScreeningRecommendations(ga.weeks),
        };
      } catch (error) {
        return {
          ...pregnancy,
          error: error.message,
        };
      }
    });
  }
  /**
   * Calculate LMP from EDD (alias for calculateLMP)
   * @param {Date} edd - Expected delivery date
   * @returns {Date} Last menstrual period
   */
  calculateLMPFromEDD(edd) {
    return this.calculateLMP(edd);
  }

  MIN_GESTATIONAL_WEEKS = 0;
  STANDARD_PREGNANCY_DAYS = 280;
  MAX_GESTATIONAL_WEEKS = 42;
}

export default new GestationalAgeService();
