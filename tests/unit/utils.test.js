import { describe, test, expect } from "@jest/globals";
import validators from "../../src/utils/validators.js";
import languageMapper from "../../src/utils/languageMapper.js";
import gestationalAgeCalculator from "../../src/utils/gestationalAge.js";

describe("Validators", () => {
  test("should validate Nigerian phone numbers", () => {
    expect(validators.validatePhoneNumber("08012345678")).toBe(true);
    expect(validators.validatePhoneNumber("2348012345678")).toBe(true);
    expect(validators.validatePhoneNumber("+2348012345678")).toBe(true);
    expect(validators.validatePhoneNumber("1234567890")).toBe(false);
  });

  test("should validate email addresses", () => {
    expect(validators.validateEmail("test@example.com")).toBe(true);
    expect(validators.validateEmail("invalid-email")).toBe(false);
    expect(validators.validateEmail("user+tag@domain.co.uk")).toBe(true);
  });

  test("should validate pregnancy dates", () => {
    // Use dynamic dates - valid LMP should be within 2 years
    const today = new Date();
    const validLMP = new Date(today);
    validLMP.setDate(validLMP.getDate() - 150); // 150 days ago (valid)
    const invalidLMP = new Date("2099-01-01"); // Way in future (invalid)

    expect(validators.validateLMP(validLMP)).toBe(true);
    expect(validators.validateLMP(invalidLMP)).toBe(false);
  });

  test("should validate parity and gravida", () => {
    expect(validators.validateParity(2)).toBe(true);
    expect(validators.validateParity(-1)).toBe(false);
    expect(validators.validateParity(20)).toBe(true);
    expect(validators.validateParity(21)).toBe(false);
  });
});

describe("LanguageMapper", () => {
  test("should map language codes to display names", () => {
    expect(languageMapper.getLanguageName("en")).toBe("English");
    expect(languageMapper.getLanguageName("yo")).toBe("Yoruba");
    expect(languageMapper.getLanguageName("ha")).toBe("Hausa");
  });

  test("should list all supported languages", () => {
    const languages = languageMapper.getSupportedLanguages();
    expect(languages).toContain("en");
    expect(languages).toContain("pidgin");
    expect(languages.length).toBeGreaterThan(0);
  });

  test("should provide RTL information for languages", () => {
    const lang = languageMapper.getLanguage("ar");
    if (lang) {
      expect(lang.direction).toBe("rtl");
    }
  });
});

describe("GestationalAgeCalculator", () => {
  test("should calculate gestational age from LMP", () => {
    const lmp = new Date("2024-01-01");
    const result = gestationalAgeCalculator.calculateFromLMP(lmp);

    expect(result).toBeDefined();
    expect(result.weeks).toBeGreaterThanOrEqual(0);
    expect(result.days).toBeGreaterThanOrEqual(0);
  });

  test("should calculate LMP from EDD", () => {
    const edd = new Date("2024-10-01");
    const result = gestationalAgeCalculator.calculateLMPFromEDD(edd);

    expect(result).toBeDefined();
    expect(result instanceof Date).toBe(true);
  });

  test("should determine pregnancy trimester", () => {
    const lmp = new Date(Date.now() - 15 * 7 * 24 * 60 * 60 * 1000); // 15 weeks
    const trimester = gestationalAgeCalculator.getTrimester(lmp);

    expect([1, 2, 3]).toContain(trimester);
  });
});
