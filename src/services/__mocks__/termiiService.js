// Mock Termii service for testing
export default {
  sendOTP: jest.fn().mockResolvedValue({
    success: true,
    messageId: `mock-${Date.now()}`,
    code: "123456",
  }),
  sendSMS: jest.fn().mockResolvedValue({
    success: true,
    messageId: `mock-${Date.now()}`,
  }),
  getDeliveryStatus: jest.fn().mockResolvedValue({
    status: "delivered",
  }),
};
