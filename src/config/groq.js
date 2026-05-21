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
};
