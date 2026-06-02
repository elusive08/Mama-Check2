export default {
  apiKey: process.env.GROQ_API_KEY,
  baseUrl: "https://api.groq.com/openai/v1",
  model: "mixtral-8x7b-32768",
  temperature: 0.3,
  maxTokens: 150,
  prompts: {
    warmMessage: `Generate a warm, culturally appropriate SMS response for a pregnant woman in {language} who reported {symptoms}. The severity is {severity}. Keep it concise (under 160 chars), empathetic, and action-oriented. Do not provide medical diagnosis.`,

    chewChecklist: `Create a brief follow-up checklist (3-5 items) for a Community Health Worker in Nigeria responding to a pregnant woman with {symptoms} at {weeks} weeks gestation. Include culturally appropriate questions about {context}.`,
  },

  /**
   * Validate and format prompt templates
   * Ensures all required placeholders are present and filled
   */
  formatPrompt(template, vars) {
    if (!template) {
      throw new Error("Prompt template is required");
    }

    // Find all placeholders in template
    const placeholderRegex = /\{([^}]+)\}/g;
    const templatePlaceholders = new Set();
    let match;

    while ((match = placeholderRegex.exec(template)) !== null) {
      templatePlaceholders.add(match[1]);
    }

    // Check if all placeholders have corresponding values
    const missingVars = Array.from(templatePlaceholders).filter(
      (placeholder) => !(placeholder in vars),
    );

    if (missingVars.length > 0) {
      throw new Error(
        `Prompt template has unfilled placeholders: ${missingVars.join(", ")}`,
      );
    }

    // Replace placeholders with actual values
    return template.replace(/\{([^}]+)\}/g, (_, key) => {
      const value = vars[key];
      return value === undefined ? `{${key}}` : String(value);
    });
  },
};
