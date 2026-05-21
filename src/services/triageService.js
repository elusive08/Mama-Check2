class TriageService {
  constructor() {
    // Red flag symptoms (immediate facility referral)
    this.RED_SYMPTOMS = [1, 2, 3, 7, 8];

    // Yellow flag symptoms (clinic visit within 24 hours)
    this.YELLOW_SYMPTOMS = [4, 5, 6];

    // Symptom mapping
    this.SYMPTOM_MAP = {
      1: {
        name: "Heavy bleeding",
        severity: "RED",
        action: "Go to facility now",
      },
      2: {
        name: "Severe headache",
        severity: "RED",
        action: "Go to facility now",
      },
      3: {
        name: "Swollen face or hand",
        severity: "RED",
        action: "Go to facility now",
      },
      4: {
        name: "Blurry vision",
        severity: "YELLOW",
        action: "Visit clinic within 24hrs",
      },
      5: {
        name: "Fever",
        severity: "YELLOW",
        action: "Visit clinic within 24hrs",
      },
      6: {
        name: "Reduced baby movement",
        severity: "YELLOW",
        action: "Visit clinic within 24hrs",
      },
      7: {
        name: "Severe abdominal pain",
        severity: "RED",
        action: "Go to facility now",
      },
      8: { name: "Convulsion", severity: "RED", action: "Go to facility now" },
      0: {
        name: "None - I am fine",
        severity: "GREEN",
        action: "Rest well. Next reminder coming soon",
      },
    };
  }

  /**
   * Triage symptom reports
   * @param {Array} symptoms - Array of symptom numbers
   * @returns {Object} Triage outcome
   */
  triage(symptoms) {
    if (!symptoms || symptoms.length === 0) {
      return this.getGreenOutcome();
    }

    // Check for any red flag symptoms
    const hasRedFlag = symptoms.some((s) => this.RED_SYMPTOMS.includes(s));
    if (hasRedFlag) {
      const redSymptoms = symptoms.filter((s) => this.RED_SYMPTOMS.includes(s));
      return this.getRedOutcome(redSymptoms);
    }

    // Check for yellow flag symptoms
    const hasYellowFlag = symptoms.some((s) =>
      this.YELLOW_SYMPTOMS.includes(s),
    );
    if (hasYellowFlag) {
      const yellowSymptoms = symptoms.filter((s) =>
        this.YELLOW_SYMPTOMS.includes(s),
      );
      return this.getYellowOutcome(yellowSymptoms);
    }

    // Check if they reported 0
    if (symptoms.includes(0)) {
      return this.getGreenOutcome();
    }

    // Default to green if no matching symptoms
    return this.getGreenOutcome();
  }

  getRedOutcome(symptoms) {
    return {
      severity: "RED",
      action: "Go to facility immediately",
      message: this.generateMessage("RED", symptoms),
      requiresChewAlert: true,
      requiresTrustedAlert: true,
      isEmergency: true,
      requiresFacilityReferral: true,
      recommendations: [
        "Go to the nearest health facility immediately",
        "Inform your CHEW or health worker",
        "Do not delay seeking emergency care",
        "This is a potential obstetric emergency",
      ],
      symptoms: symptoms.map((s) => this.SYMPTOM_MAP[s]),
    };
  }

  getYellowOutcome(symptoms) {
    return {
      severity: "YELLOW",
      action: "Visit clinic within 24 hours",
      message: this.generateMessage("YELLOW", symptoms),
      requiresChewAlert: false,
      requiresTrustedAlert: false,
      isEmergency: false,
      requiresFacilityReferral: false,
      recommendations: [
        "Visit your clinic within 24 hours",
        "Inform your CHEW or health worker",
        "Seek assessment before symptoms worsen",
      ],
      symptoms: symptoms.map((s) => this.SYMPTOM_MAP[s]),
    };
  }

  getGreenOutcome() {
    return {
      severity: "GREEN",
      action: "Continue normal care",
      message: this.SYMPTOM_MAP[0].action,
      requiresChewAlert: false,
      requiresTrustedAlert: false,
      isEmergency: false,
      requiresFacilityReferral: false,
      recommendations: [
        "Continue with your regular pregnancy care",
        "Keep your scheduled clinic appointments",
        "Contact your CHEW if symptoms develop",
      ],
      symptoms: [],
    };
  }

  generateMessage(severity, symptoms) {
    const symptomNames = symptoms
      .map((s) => this.SYMPTOM_MAP[s].name)
      .join(", ");

    switch (severity) {
      case "RED":
        return `⚠️ URGENT: You reported: ${symptomNames}. Please go to your health facility IMMEDIATELY. This is a potential emergency. MamaCheck is a safety guide, not a doctor.`;
      case "YELLOW":
        return `⚠️ ATTENTION: You reported: ${symptomNames}. Please visit your clinic within the next 24 hours for assessment. MamaCheck is a safety guide, not a doctor.`;
      default:
        return `✓ Thank you for your report. ${this.SYMPTOM_MAP[0].action}. MamaCheck is a safety guide, not a doctor.`;
    }
  }

  /**
   * Validate symptoms against WHO emergency criteria
   * @param {Array} symptoms - Reported symptoms
   * @returns {boolean} True if meets emergency criteria
   */
  validateEmergencyCriteria(symptoms) {
    // WHO obstetric emergency criteria
    const emergencyCombinations = [
      [1], // Heavy bleeding alone
      [2, 3], // Severe headache + swelling
      [8], // Convulsion alone
      [7], // Severe abdominal pain alone
      [1, 7], // Bleeding + pain
    ];

    return emergencyCombinations.some((combination) =>
      combination.every((symptom) => symptoms.includes(symptom)),
    );
  }

  /**
   * Calculate risk score from symptoms
   * @param {Array} symptoms - Array of symptom numbers
   * @returns {number} Risk score 0-100
   */
  calculateRiskScore(symptoms) {
    if (!symptoms || symptoms.length === 0) return 0;

    let score = 0;

    // Add base score for each RED symptom
    const redCount = symptoms.filter((s) => this.RED_SYMPTOMS.includes(s))
      .length;
    score += redCount * 25;

    // Add score for each YELLOW symptom
    const yellowCount = symptoms.filter((s) =>
      this.YELLOW_SYMPTOMS.includes(s),
    ).length;
    score += yellowCount * 10;

    // Cap score at 100
    return Math.min(score, 100);
  }
}

export default new TriageService();
