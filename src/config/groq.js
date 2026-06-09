/**
 * Groq AI configuration and prompt utilities.
 *
 * Exports the full GroqConfig instance so callers have access to
 * both `config` (the plain options object) and helper methods
 * (`formatPrompt`, `validate`).
 *
 * Usage:
 *   import groqConfig from './config/groq.js';
 *   const prompt = groqConfig.formatPrompt(groqConfig.config.prompts.warmMessage, vars);
 */
class GroqConfig {
  constructor() {
    // Defer validation — don't throw during import before the app
    // has a chance to set up logging or call process.exit() cleanly.
    // Call validate() explicitly during startup (see index.js).
    this.apiKey = process.env.GROQ_API_KEY || null;
  }

  /**
   * Validate API key. Called explicitly at startup.
   * Throws in production if key is missing or obviously invalid.
   */
  validateApiKey() {
    if (!this.apiKey) {
      if (process.env.NODE_ENV === "production") {
        throw new Error("FATAL: GROQ_API_KEY is required in production");
      }
      console.warn("WARNING: GROQ_API_KEY not set. AI features will not work.");
      return;
    }

    if (this.apiKey.length < 20) {
      throw new Error("GROQ_API_KEY appears to be invalid (too short)");
    }
  }

  get config() {
    return {
      apiKey: this.apiKey,
      baseUrl: "https://api.groq.com/openai/v1",
      // mixtral-8x7b-32768 was deprecated by Groq; default to llama3-8b-8192
      model: process.env.GROQ_MODEL || "llama3-8b-8192",
      temperature: Number.parseFloat(process.env.GROQ_TEMPERATURE) || 0.3,
      maxTokens: Number.parseInt(process.env.GROQ_MAX_TOKENS) || 150,
      timeout: Number.parseInt(process.env.GROQ_TIMEOUT_MS) || 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      prompts: {
        warmMessage: `Generate a warm, culturally appropriate SMS response for a pregnant woman in {language} who reported {symptoms}. The severity is {severity}. Keep it concise (under 160 chars), empathetic, and action-oriented. Do not provide medical diagnosis.`,
        chewChecklist: `Create a brief follow-up checklist (3-5 items) for a Community Health Worker in Nigeria responding to a pregnant woman with {symptoms} at {weeks} weeks gestation. Include culturally appropriate questions about {context}.`,
      },
    };
  }

  /**
   * Fill a prompt template with variable values.
   * All placeholders ({varName}) must be present in `vars`.
   *
   * @param {string} template
   * @param {Record<string, string | number>} vars
   * @returns {string}
   */
  formatPrompt(template, vars) {
    if (!template) throw new Error("Prompt template is required");
    if (!vars || typeof vars !== "object")
      throw new Error("vars must be an object");

    if (!this.apiKey) {
      throw new Error("GROQ_API_KEY not configured. Cannot format prompt.");
    }

    // Collect all {placeholder} names
    const placeholderRegex = /\{([^}]+)\}/g;
    const required = new Set();
    let match;
    while ((match = placeholderRegex.exec(template)) !== null) {
      required.add(match[1]);
    }

    const missing = [...required].filter(
      (key) => !(key in vars) || vars[key] === undefined || vars[key] === null,
    );
    if (missing.length > 0) {
      throw new Error(
        `Prompt template missing values for: ${missing.join(", ")}`,
      );
    }

    // Sanitize: stringify, trim, cap at 500 chars to prevent prompt injection
    const safe = {};
    for (const [key, value] of Object.entries(vars)) {
      safe[key] = String(value).trim().substring(0, 500);
    }

    return template.replace(/\{([^}]+)\}/g, (_, key) =>
      key in safe ? safe[key] : `{${key}}`,
    );
  }

  /**
   * Validate the full configuration. Returns { valid, issues }.
   * Call this during startup after validateApiKey().
   */
  validate() {
    const issues = [];

    if (!this.apiKey) issues.push("GROQ_API_KEY is missing");

    const timeout = Number.parseInt(process.env.GROQ_TIMEOUT_MS);
    if (!Number.isNaN(timeout) && (timeout < 1000 || timeout > 120000)) {
      issues.push("GROQ_TIMEOUT_MS should be between 1000 and 120000");
    }

    const temp = Number.parseFloat(process.env.GROQ_TEMPERATURE);
    if (!Number.isNaN(temp) && (temp < 0 || temp > 2)) {
      issues.push("GROQ_TEMPERATURE should be between 0 and 2");
    }

    if (process.env.GROQ_MODEL === "mixtral-8x7b-32768") {
      issues.push(
        "GROQ_MODEL 'mixtral-8x7b-32768' is deprecated; update to 'llama3-8b-8192' or 'llama3-70b-8192'",
      );
    }

    return { valid: issues.length === 0, issues };
  }
}

// Export the full instance — callers get both `.config` and helper methods
export default new GroqConfig();
