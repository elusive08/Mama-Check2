import mongoose from "mongoose";
import dotenv from "dotenv";

// Load test environment variables
dotenv.config({ path: ".env.test" });

// Increase mongoose timeout for Atlas connections
mongoose.set("bufferCommands", true);
mongoose.set("bufferTimeoutMS", 60000);

// Global beforeAll hook
beforeAll(async () => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI not set. Please check .env.test file");
  }

  console.log("Connecting to MongoDB Atlas...");

  // Disconnect any existing connections
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    connectTimeoutMS: 30000,
    maxPoolSize: 10,
    minPoolSize: 2,
    retryWrites: true,
    retryReads: true,
  });

  console.log("Connected to MongoDB Atlas");
}, 120000);

// Global afterAll hook
afterAll(async () => {
  await mongoose.disconnect();
  console.log("Disconnected from MongoDB");
});

// Global beforeEach: intentionally empty.
// Unit tests clean up their own mocks/state inline.
// Integration tests manage their own DB cleanup in their local beforeEach/afterEach
// so they can persist setup data (admin, CHEW) across the test lifecycle.
// DO NOT wipe collections here — it would delete admin/CHEW users created in
// integration test beforeAll blocks before the test's own beforeEach runs.

// Error handlers
mongoose.connection.on("error", (err) => {
  console.error("MongoDB connection error:", err);
});

mongoose.connection.on("disconnected", () => {
  console.log("MongoDB disconnected");
});

mongoose.connection.on("connected", () => {
  console.log("MongoDB connected");
});
