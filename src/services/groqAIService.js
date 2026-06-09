import Groq from "groq-sdk";

/**
 * Groq AI Service for generating warm, non-alarming triage responses
 */

class GroqAIService {
  constructor() {
    this.client = new Groq({
      apiKey: process.env.GROQ_API_KEY,
    });
    this.model = "mixtral-8x7b-32768"; // Fast model suitable for real-time responses
  }

  /**
   * Generate warm triage response text based on outcome and symptoms
   * @param {string} outcome - 'GREEN', 'YELLOW', or 'RED'
   * @param {Array} symptoms - Reported symptom numbers
   * @param {string} language - Language code (en, pidgin, yo, ha, ig)
   * @returns {Promise<string>} - Generated message
   */
  async generateTriageResponse(outcome, symptoms, language = "en") {
    if (!process.env.GROQ_API_KEY) {
      console.warn(
        "GROQ_API_KEY not configured. Using fallback static template.",
      );
      return null; // Fallback to static template
    }

    const systemPrompt = `You are a healthcare communication specialist for MamaCheck, a pregnancy support system in Nigeria.
Your role is to generate warm, empathetic, non-alarming SMS responses to pregnant women about their symptoms.
- Keep messages under 160 characters for SMS.
- Always include a disclaimer that MamaCheck is a safety guide, not a doctor.
- Use ${language === "en" ? "English" : language} language.
- Be culturally sensitive and respectful.
- Never provide medical diagnosis.
- Focus on next steps and encouragement.`;

    const userPrompt = `Generate a brief, warm SMS response for a pregnant woman with triage outcome "${outcome}" who reported symptoms: ${symptoms.join(", ")}.
Language: ${language}
Context: The woman is in Nigeria and may be using a feature phone.
Requirements:
- Maximum 160 characters including disclaimer
- Warm and empathetic tone
- Clear next action
- Include: "MamaCheck is a safety guide, not a doctor"`;

    try {
      // FIXED: Used chat.completions.create() instead of messages.create()
      const chatCompletion = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 200,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
          },
        ],
      });

      const responseText = chatCompletion.choices[0]?.message?.content;

      if (!responseText) {
        console.warn("Invalid response from Groq");
        return null;
      }

      return responseText.trim();
    } catch (error) {
      console.error("Error calling Groq API:", error);
      return null; // Fallback to static template on error
    }
  }

  /**
   * Generate CHEW follow-up checklist for RED alerts
   * @param {Object} caseData - Case information (woman name, symptoms, week)
   * @returns {Promise<string>} - Generated checklist
   */
  async generateCHEWChecklist(caseData) {
    if (!process.env.GROQ_API_KEY) {
      return null;
    }

    const prompt = `Generate a brief follow-up checklist for a CHEW (Community Health Extension Worker) for this RED alert case:
Woman: ${caseData.womanName}
Symptoms: ${caseData.symptoms}
Gestational Week: ${caseData.gestationalWeek}
Phone: ${caseData.phone}

Provide 3-4 clear action items in bullet format.
Keep it concise and actionable.`;

    try {
      // FIXED: Use chat.completions.create() instead of messages.create()
      const chatCompletion = await this.client.chat.completions.create({
        model: this.model,
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      return chatCompletion.choices[0]?.message?.content || null;
    } catch (error) {
      console.error("Error generating CHEW checklist:", error);
      return null;
    }
  }
}

export default new GroqAIService();
