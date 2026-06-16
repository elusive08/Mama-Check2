import mongoose from "mongoose";
import dotenv from "dotenv";
import { MongoMemoryServer } from "mongodb-memory-server";

// Load test environment variables
dotenv.config({ path: ".env.test" });

// Increase mongoose timeout for Atlas connections
mongoose.set("bufferCommands", true);
mongoose.set("bufferTimeoutMS", 60000);

let mongoServer;

// Global beforeAll hook
beforeAll(async () => {
  // ✅ Use in-memory MongoDB for tests instead of Atlas
  console.log("Starting MongoDB memory server...");
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();

  console.log("Connecting to in-memory MongoDB...");

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

  console.log("Connected to in-memory MongoDB");
}, 120000);

// Global afterAll hook
afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
  console.log("Disconnected from MongoDB");
});

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
