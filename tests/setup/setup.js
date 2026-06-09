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

// Before each test - clear collections
beforeEach(async () => {
  if (mongoose.connection.readyState === 1) {
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      try {
        await collections[key].deleteMany({});
      } catch (err) {
        // Collection might not exist yet
        console.log(`Could not clear ${key}:`, err.message);
      }
    }
  }
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
