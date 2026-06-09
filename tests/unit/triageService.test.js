import triageService from "../../src/services/triageService.js";

describe("TriageService", () => {
  describe("Triage classification", () => {
    test("should return RED for heavy bleeding", () => {
      const result = triageService.triage([1]);
      expect(result.severity).toBe("RED");
      expect(result.requiresChewAlert).toBe(true);
    });

    test("should return RED for convulsion", () => {
      const result = triageService.triage([8]);
      expect(result.severity).toBe("RED");
    });

    test("should return RED for severe headache", () => {
      const result = triageService.triage([2]);
      expect(result.severity).toBe("RED");
    });

    test("should return YELLOW for fever", () => {
      const result = triageService.triage([5]);
      expect(result.severity).toBe("YELLOW");
      expect(result.requiresChewAlert).toBe(false);
    });

    test("should return YELLOW for vaginal discharge", () => {
      const result = triageService.triage([6]);
      expect(result.severity).toBe("YELLOW");
    });

    test("should return GREEN for no symptoms", () => {
      const result = triageService.triage([0]);
      expect(result.severity).toBe("GREEN");
    });

    test("should prioritize RED over YELLOW", () => {
      const result = triageService.triage([1, 5]);
      expect(result.severity).toBe("RED");
    });

    test("should prioritize YELLOW over GREEN", () => {
      const result = triageService.triage([5, 0]);
      expect(result.severity).toBe("YELLOW");
    });

    test("should handle empty symptom list", () => {
      const result = triageService.triage([]);
      expect(["RED", "YELLOW", "GREEN"]).toContain(result.severity);
    });

    test("should mark RED as emergency", () => {
      const result = triageService.triage([1]);
      expect(result.isEmergency).toBe(true);
    });

    test("should mark YELLOW as non-emergency", () => {
      const result = triageService.triage([5]);
      expect(result.isEmergency).toBe(false);
    });
  });

  describe("Risk assessment", () => {
    test("should generate recommendations for RED severity", () => {
      const result = triageService.triage([1]);
      expect(result.recommendations).toBeDefined();
      expect(result.recommendations.length).toBeGreaterThan(0);
    });

    test("should calculate risk score from symptoms", () => {
      const score = triageService.calculateRiskScore([1]);
      expect(typeof score).toBe("number");
      expect(score).toBeGreaterThan(0);
    });

    test("should indicate when facility referral is needed", () => {
      const result = triageService.triage([1]);
      expect(result.requiresFacilityReferral).toBe(true);
    });
  });
});
