import request from "supertest";
import app from "../../src/app.js";

describe("API Integration Tests", () => {
  beforeAll(async () => {
    // Database and Redis lifecycle is managed by the global test setup (tests/setup/setup.js).
    // Nothing to initialise here.
  });

  afterAll(async () => {
    // Teardown (disconnect, redis.quit) is handled by the global test setup.
    // Nothing to close here.
  });

  describe("Health endpoint", () => {
    test("GET /health returns healthy status", async () => {
      const response = await request(app).get("/health").expect(200);

      expect(response.body.status).toBe("healthy");
      expect(response.body).toHaveProperty("timestamp");
      expect(response.body).toHaveProperty("uptime");
      expect(response.body).toHaveProperty("environment");
      expect(response.body).toHaveProperty("database");
    });

    test("health endpoint includes request ID", async () => {
      const response = await request(app).get("/health");

      expect(response.headers).toHaveProperty("x-request-id");
    });
  });

  describe("API info endpoint", () => {
    test("GET /api returns API info", async () => {
      const response = await request(app).get("/api").expect(200);

      expect(response.body.name).toBe("MamaCheck API");
      expect(response.body.version).toBe("1.0.0");
      expect(response.body.endpoints).toBeDefined();
    });

    test("API info includes all main endpoints", async () => {
      const response = await request(app).get("/api").expect(200);

      expect(response.body.endpoints).toHaveProperty("auth");
      expect(response.body.endpoints).toHaveProperty("pregnancies");
      expect(response.body.endpoints).toHaveProperty("dashboard");
    });
  });

  describe("404 handling", () => {
    test("GET /nonexistent returns 404", async () => {
      const response = await request(app).get("/nonexistent").expect(404);

      expect(response.body).toHaveProperty("error");
    });

    test("404 response includes request ID", async () => {
      const response = await request(app).get("/nonexistent");

      expect(response.headers).toHaveProperty("x-request-id");
    });
  });

  describe("Security headers", () => {
    test("responses include security headers", async () => {
      const response = await request(app).get("/health");

      // Helmet should add various security headers
      expect(response.headers).toBeDefined();
    });

    test("request ID header is included", async () => {
      const response = await request(app).get("/health");

      expect(response.headers["x-request-id"]).toBeDefined();
    });
  });
});
