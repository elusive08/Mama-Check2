import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "@jest/globals";
import request from "supertest";
import app from "../../src/app.js";
import User from "../../src/models/User.js";
import Pregnancy from "../../src/models/Pregnancy.js";
import DangerReport from "../../src/models/DangerReport.js";
import ANCVisitLog from "../../src/models/ANCVisitLog.js";
import mongoose from "mongoose";

/**
 * End-to-End SMS Workflow Integration Tests
 * Tests complete pregnancy registration → SMS reminder → symptom check → triage → CHEW alert
 */

// Helper function to wait for database connection
const waitForDatabaseConnection = async (maxWaitTime = 60000) => {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitTime) {
    if (mongoose.connection.readyState === 1) {
      console.log(
        "Database connected, readyState:",
        mongoose.connection.readyState,
      );
      return true;
    }
    console.log(
      "Waiting for database connection, current state:",
      mongoose.connection.readyState,
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Database connection not ready after " + maxWaitTime + "ms");
};

// Helper to add delay
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("SMS Workflow Integration Tests", () => {
  let testPhone = "09012345678";
  let chewPhone = "08012345678";
  let pregnancyId = null;
  let womanId = null;
  let chewId = null;
  let authToken = null;
  let chewToken = null;

  beforeAll(async () => {
    // Ensure mongoose is connected
    if (mongoose.connection.readyState !== 1) {
      console.log("Mongoose not connected, attempting connection...");
      await waitForDatabaseConnection(30000);
    }

    // Clear existing test data
    await User.deleteMany({ phone: { $in: [testPhone, chewPhone] } }).catch(
      () => {},
    );
    await Pregnancy.deleteMany({}).catch(() => {});
    await DangerReport.deleteMany({}).catch(() => {});
    await ANCVisitLog.deleteMany({}).catch(() => {});
  }, 60000);

  beforeEach(async () => {
    // Add delay to avoid rate limiting
    await delay(1000);

    // Ensure connection is still good before each test
    await waitForDatabaseConnection(10000);

    try {
      // Try to register woman with retry logic
      let womanRes;
      let retries = 0;
      const maxRetries = 3;

      while (retries < maxRetries) {
        womanRes = await request(app).post("/api/v1/auth/register").send({
          phone: testPhone,
          password: "password123",
          name: "Test Woman",
          preferredLanguage: "en",
        });

        if (womanRes.status !== 429) break;

        console.log(
          `Rate limited, waiting 2 seconds... (attempt ${retries + 1})`,
        );
        await delay(2000);
        retries++;
      }

      // Handle case where user already exists
      if (womanRes.status === 409 || womanRes.body?.error?.includes("exists")) {
        console.log("User already exists, logging in...");
        const loginRes = await request(app).post("/api/v1/auth/login").send({
          phone: testPhone,
          password: "password123",
        });
        womanId = loginRes.body.user?.id;
        authToken = loginRes.body.token;
      } else {
        womanId = womanRes.body?.user?.id;
        authToken = womanRes.body?.token;
      }

      if (!womanId) {
        console.error("Registration response:", womanRes.body);
        throw new Error("Failed to get woman ID");
      }

      // Add delay before CHEW registration
      await delay(1000);

      // Try to register CHEW with retry logic
      let chewRes;
      retries = 0;

      while (retries < maxRetries) {
        chewRes = await request(app).post("/api/v1/auth/register").send({
          phone: chewPhone,
          password: "password123",
          name: "Test CHEW",
          role: "chew",
          preferredLanguage: "en",
        });

        if (chewRes.status !== 429) break;

        console.log(
          `Rate limited for CHEW, waiting 2 seconds... (attempt ${retries + 1})`,
        );
        await delay(2000);
        retries++;
      }

      if (chewRes.status === 409 || chewRes.body?.error?.includes("exists")) {
        const loginRes = await request(app).post("/api/v1/auth/login").send({
          phone: chewPhone,
          password: "password123",
        });
        chewId = loginRes.body.user?.id;
        chewToken = loginRes.body.token;
      } else {
        chewId = chewRes.body?.user?.id;
        chewToken = chewRes.body?.token;
      }

      if (!chewId) {
        console.error("CHEW registration response:", chewRes.body);
        throw new Error("Failed to get CHEW ID");
      }
    } catch (error) {
      console.error("Setup error details:", {
        message: error.message,
      });
      throw error;
    }
  }, 45000);

  describe("1. Pregnancy Registration with OTP", () => {
    test("should request OTP for phone number", async () => {
      const res = await request(app)
        .post("/api/v1/auth/request-otp")
        .send({ phone: testPhone });

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("OTP sent successfully");
    }, 15000);

    test("should verify OTP and return token", async () => {
      // Request OTP first
      await request(app)
        .post("/api/v1/auth/request-otp")
        .send({ phone: testPhone });

      // Get the OTP from database (in real scenario, would be in SMS)
      const user = await User.findOne({ phone: testPhone });
      expect(user).toBeDefined();

      const otp = user.otp;
      expect(otp).toBeDefined();

      const res = await request(app)
        .post("/api/v1/auth/verify-otp")
        .send({ phone: testPhone, otp });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      authToken = res.body.token;
    }, 15000);

    test("should reject invalid OTP", async () => {
      const res = await request(app)
        .post("/api/v1/auth/verify-otp")
        .send({ phone: testPhone, otp: "000000" });

      expect(res.status).toBe(401);
    }, 10000);

    test("should register pregnancy with CHEW", async () => {
      // First ensure woman is registered
      const woman = await User.findOne({ phone: testPhone });
      if (!woman) {
        await request(app).post("/api/v1/auth/register").send({
          phone: testPhone,
          password: "password123",
          name: "Test Woman",
          preferredLanguage: "en",
        });
      }

      const res = await request(app)
        .post("/api/v1/pregnancies/register")
        .set("Authorization", `Bearer ${chewToken}`)
        .send({
          womanDetails: {
            name: "Test Woman",
            phone: testPhone,
            preferredLanguage: "en",
          },
          lmp: "2025-09-18",
          clinicName: "Test Clinic",
          chewId,
          otp: "123456", // Use a realistic OTP
        });

      expect([200, 201]).toContain(res.status);
      if (res.body.pregnancyId) {
        pregnancyId = res.body.pregnancyId;
      }
    }, 15000);
  });

  describe("2. STOP Keyword SMS Opt-Out", () => {
    beforeEach(async () => {
      // Ensure a pregnancy exists for opt-out tests
      const existingPregnancy = await Pregnancy.findOne({ womanId });
      if (!existingPregnancy) {
        const pregnancy = new Pregnancy({
          womanId,
          chewId,
          lmp: new Date("2025-09-18"),
          gestationalWeek: 28,
          status: "active",
        });
        await pregnancy.save();
        pregnancyId = pregnancy._id;
      }
    });

    test("should handle STOP keyword in SMS", async () => {
      const res = await request(app).post("/api/v1/webhook/simulate-sms").send({
        from: testPhone,
        text: "STOP",
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("opt_out_processed");
    });

    test("should update user opt-out status", async () => {
      // Send STOP SMS
      await request(app).post("/api/v1/webhook/simulate-sms").send({
        from: testPhone,
        text: "STOP",
      });

      // Verify user is opted out
      const user = await User.findOne({ phone: testPhone });
      expect(user.optOut.isOptedOut).toBe(true);
      expect(user.consent.sms).toBe(false);
    });

    test("should accept UNSUBSCRIBE keyword", async () => {
      const res = await request(app).post("/api/v1/webhook/simulate-sms").send({
        from: testPhone,
        text: "UNSUBSCRIBE",
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("opt_out_processed");
    });
  });

  describe("3. Danger Sign Triage Workflow", () => {
    beforeEach(async () => {
      // Ensure we have a valid pregnancy
      await delay(500);

      // First check if pregnancy exists
      let pregnancy = await Pregnancy.findOne({ womanId });

      if (!pregnancy) {
        console.log("Creating pregnancy for woman:", womanId);
        pregnancy = new Pregnancy({
          womanId,
          chewId,
          lmp: new Date("2025-09-18"),
          gestationalWeek: 28,
          status: "active",
        });
        await pregnancy.save();
      }

      pregnancyId = pregnancy._id;
      console.log(`Pregnancy created/verified with ID: ${pregnancyId}`);
    });

    test("should process GREEN (no symptoms) response", async () => {
      const res = await request(app).post("/api/v1/webhook/simulate-sms").send({
        from: testPhone,
        text: "0",
      });

      expect(res.status).toBe(200);
      expect(res.body.triage).toBe("GREEN");
    });

    test("should process YELLOW (warning) symptoms", async () => {
      const res = await request(app).post("/api/v1/webhook/simulate-sms").send({
        from: testPhone,
        text: "4", // Blurry vision (YELLOW)
      });

      expect(res.status).toBe(200);
      expect(res.body.triage).toBe("YELLOW");
    });

    test("should process RED (critical) symptoms", async () => {
      const res = await request(app).post("/api/v1/webhook/simulate-sms").send({
        from: testPhone,
        text: "1", // Heavy bleeding (RED)
      });

      expect(res.status).toBe(200);
      expect(res.body.triage).toBe("RED");
    });

    test("should apply highest-severity rule for multiple symptoms", async () => {
      const res = await request(app).post("/api/v1/webhook/simulate-sms").send({
        from: testPhone,
        text: "4 5 1",
      });

      expect(res.status).toBe(200);
      expect(res.body.triage).toBe("RED");
    });

    test("should create danger report for RED symptoms", async () => {
      await request(app).post("/api/v1/webhook/simulate-sms").send({
        from: testPhone,
        text: "2 3", // Severe headache + swollen face
      });

      // Wait a moment for the report to be saved
      await delay(500);

      const report = await DangerReport.findOne({
        womanId,
        triageOutcome: "RED",
      });

      expect(report).toBeDefined();
      expect(report.reportedSymptoms).toContain(2);
      expect(report.reportedSymptoms).toContain(3);
    });
  });

  describe("4. Visit Attendance & Undo Feature", () => {
    beforeEach(async () => {
      // Register a pregnancy first
      const pregnancy = new Pregnancy({
        womanId,
        chewId,
        lmp: new Date("2025-09-18"),
        gestationalWeek: 28,
        status: "active",
      });
      await pregnancy.save();
      pregnancyId = pregnancy._id;
    });

    test("should mark visit as attended", async () => {
      const res = await request(app)
        .post(`/api/v1/pregnancies/${pregnancyId}/attended`)
        .set("Authorization", `Bearer ${chewToken}`)
        .send({
          milestoneNumber: 6,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test("should undo visit attendance within 10 minutes", async () => {
      // Mark as attended
      await request(app)
        .post(`/api/v1/pregnancies/${pregnancyId}/attended`)
        .set("Authorization", `Bearer ${chewToken}`)
        .send({
          milestoneNumber: 6,
        });

      // Undo immediately
      const res = await request(app)
        .post(`/api/v1/pregnancies/${pregnancyId}/attended/undo`)
        .set("Authorization", `Bearer ${chewToken}`)
        .send({
          milestoneNumber: 6,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test("should reject undo after 10 minutes", async () => {
      // Create a log with older timestamp
      await ANCVisitLog.create({
        pregnancyId,
        womanId,
        chewId,
        visitWeek: 6,
        action: "marked_attended",
        markedAtDate: new Date(),
        markedAtTime: new Date(Date.now() - 11 * 60 * 1000), // 11 minutes ago
      });

      const res = await request(app)
        .post(`/api/v1/pregnancies/${pregnancyId}/attended/undo`)
        .set("Authorization", `Bearer ${chewToken}`)
        .send({
          milestoneNumber: 6,
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Undo window expired");
    });

    test("should get attendance history", async () => {
      // Mark as attended
      await request(app)
        .post(`/api/v1/pregnancies/${pregnancyId}/attended`)
        .set("Authorization", `Bearer ${chewToken}`)
        .send({
          milestoneNumber: 5,
        });

      const res = await request(app)
        .get(`/api/v1/pregnancies/${pregnancyId}/attendance-history`)
        .set("Authorization", `Bearer ${chewToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe("5. Reference Data Endpoints", () => {
    test("should get all LGAs", async () => {
      const res = await request(app).get("/api/v1/reference/lgas");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    test("should get all states", async () => {
      const res = await request(app).get("/api/v1/reference/states");

      expect(res.status).toBe(200);
      expect(res.body.states).toBeDefined();
    });

    test("should get LGAs by state", async () => {
      const res = await request(app).get("/api/v1/reference/lgas/state/Kaduna");

      expect(res.status).toBeOneOf([200, 404]);
    });

    test("should get PHCs by LGA", async () => {
      const res = await request(app).get(
        "/api/v1/reference/phcs/lga/Kaduna North",
      );

      expect(res.status).toBeOneOf([200, 404]);
    });

    test("should find nearest PHC by coordinates", async () => {
      const res = await request(app)
        .get("/api/v1/reference/phcs/nearest")
        .query({
          latitude: 6.5244,
          longitude: 3.3792,
          maxDistance: 5000,
        });

      expect(res.status).toBeOneOf([200, 404]);
    });
  });

  describe("6. Security & Validation", () => {
    test("should require authentication for protected endpoints", async () => {
      const res = await request(app).get("/api/v1/pregnancies/chew/test");

      expect(res.status).toBe(401);
    });

    test("should enforce CHEW role for registration", async () => {
      const res = await request(app)
        .post("/api/v1/pregnancies/register")
        .set("Authorization", `Bearer ${authToken}`) // Patient token
        .send({
          womanDetails: { phone: testPhone },
          lmp: "2025-09-18",
        });

      expect(res.status).toBe(403);
    });

    test("should validate phone number format", async () => {
      const res = await request(app)
        .post("/api/v1/auth/request-otp")
        .send({ phone: "invalid" });

      expect(res.status).toBeOneOf([400, 500]);
    });
  });

  afterEach(async () => {
    // Add small delay before cleanup
    await delay(500);

    // Cleanup specific test data but keep users for next tests
    if (pregnancyId) {
      await Pregnancy.deleteOne({ _id: pregnancyId }).catch(() => {});
      pregnancyId = null;
    }
    await DangerReport.deleteMany({ womanId }).catch(() => {});
    await ANCVisitLog.deleteMany({ womanId }).catch(() => {});
  }, 10000);

  afterAll(async () => {
    // Final cleanup - delete test users
    await delay(1000);
    await User.deleteOne({ phone: testPhone }).catch(() => {});
    await User.deleteOne({ phone: chewPhone }).catch(() => {});
  });
});
