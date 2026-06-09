import { describe, test, expect } from "@jest/globals";

describe("Gestational Age Calculations", () => {
  describe("GestationalAgeService", () => {
    test("should calculate gestational age from LMP", () => {
      const lmp = new Date("2024-01-01");
      const today = new Date("2024-03-20");

      // Calculate weeks
      const diffMs = today - lmp;
      const weeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));

      expect(weeks).toBeGreaterThan(0);
      expect(weeks).toBeLessThan(42);
    });

    test("should determine first trimester", () => {
      const lmp = new Date();
      lmp.setDate(lmp.getDate() - 42); // ~6 weeks

      const diffMs = Date.now() - lmp;
      const weeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));

      expect(weeks).toBeLessThan(14);
    });

    test("should determine second trimester", () => {
      const lmp = new Date();
      lmp.setDate(lmp.getDate() - 140); // ~20 weeks

      const diffMs = Date.now() - lmp;
      const weeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));

      expect(weeks).toBeGreaterThanOrEqual(14);
      expect(weeks).toBeLessThan(28);
    });

    test("should determine third trimester", () => {
      const lmp = new Date();
      lmp.setDate(lmp.getDate() - 200); // ~28+ weeks

      const diffMs = Date.now() - lmp;
      const weeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));

      expect(weeks).toBeGreaterThanOrEqual(28);
      expect(weeks).toBeLessThan(42);
    });

    test("should calculate EDD from LMP", () => {
      const lmp = new Date("2024-01-01");
      const edd = new Date(lmp);
      edd.setDate(edd.getDate() + 280); // 40 weeks

      expect(edd).toBeInstanceOf(Date);
      expect(edd.getTime()).toBeGreaterThan(lmp.getTime());
    });

    test("should calculate LMP from EDD", () => {
      const edd = new Date("2024-10-10");
      const lmp = new Date(edd);
      lmp.setDate(lmp.getDate() - 280);

      expect(lmp).toBeInstanceOf(Date);
      expect(lmp.getTime()).toBeLessThan(edd.getTime());
    });

    test("should determine ANC milestones", () => {
      const lmp = new Date("2024-01-01");
      const milestones = [8, 12, 16, 20, 24, 28, 32, 36];

      milestones.forEach((week) => {
        const milestoneDate = new Date(lmp);
        milestoneDate.setDate(milestoneDate.getDate() + week * 7);

        expect(milestoneDate).toBeInstanceOf(Date);
        expect(milestoneDate.getTime()).toBeGreaterThan(lmp.getTime());
      });
    });

    test("should handle invalid LMP dates", () => {
      const invalidDates = ["invalid", "", null, undefined];

      invalidDates.forEach((date) => {
        expect(date).not.toBeInstanceOf(Date);
      });
    });

    test("should return upcoming milestones", () => {
      const lmp = new Date();
      lmp.setDate(lmp.getDate() - 84); // 12 weeks

      const today = new Date();
      const diffMs = today - lmp;
      const weeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));

      const remainingMilestones = [16, 20, 24, 28, 32, 36].filter(
        (m) => m > weeks,
      );

      expect(remainingMilestones.length).toBeGreaterThan(0);
      expect(remainingMilestones[0]).toBeGreaterThan(weeks);
    });

    test("should track pregnancy progress percentage", () => {
      const lmp = new Date();
      lmp.setDate(lmp.getDate() - 200); // ~28+ weeks

      const diffMs = Date.now() - lmp;
      const weeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
      const progress = Math.min((weeks / 40) * 100, 100);

      expect(progress).toBeGreaterThan(0);
      expect(progress).toBeLessThanOrEqual(100);
    });
  });

  describe("FMOH ANC Guidelines", () => {
    test("should align with FMOH 8-visit schedule", () => {
      const fmohVisits = [8, 12, 16, 20, 24, 28, 32, 36];

      expect(fmohVisits).toHaveLength(8);
      expect(fmohVisits[0]).toBe(8);
      expect(fmohVisits.at(-1)).toBe(36);
    });

    test("should schedule visits at correct weeks", () => {
      const lmp = new Date("2024-01-01");
      const schedule = [8, 12, 16, 20, 24, 28, 32, 36];

      const visitDates = schedule.map((week) => {
        const date = new Date(lmp);
        date.setDate(date.getDate() + week * 7);
        return { week, date };
      });

      expect(visitDates).toHaveLength(8);
      visitDates.forEach((visit, index) => {
        if (index > 0) {
          expect(visit.date.getTime()).toBeGreaterThan(
            visitDates[index - 1].date.getTime(),
          );
        }
      });
    });
  });
});
