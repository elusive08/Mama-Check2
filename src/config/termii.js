export default {
  apiKey: process.env.TERMII_API_KEY,
  senderId: process.env.TERMII_SENDER_ID || "MamaCheck",
  baseUrl: "https://api.termii.com/api",
  channels: {
    sms: "generic",
    whatsapp: "whatsapp",
    voice: "voice",
  },
  retryConfig: {
    maxRetries: 3,
    backoffFactor: 2,
    initialDelay: 1000, // milliseconds
  },
};
