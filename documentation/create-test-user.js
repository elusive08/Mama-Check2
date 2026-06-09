import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./src/models/User.js";
import CHEWProfile from "./src/models/CHEWProfile.js";

dotenv.config();

async function createTestUser() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to database");

    // Create test CHEW user
    const testUser = await User.findOneAndUpdate(
      { phone: "08134490997" },
      {
        name: "Test CHEW",
        phone: "08134490997",
        password: process.env.TEST_USER_PASSWORD, // Will be hashed by middleware
        role: "chew",
        preferredLanguage: "en",
        consent: { sms: true, dataProcessing: true },
      },
      { upsert: true, new: true },
    );

    console.log("✅ Test user created:", testUser._id);

    // Create CHEW profile
    const chewProfile = await CHEWProfile.findOneAndUpdate(
      { userId: testUser._id },
      {
        userId: testUser._id,
        phcId: "PHC001",
        phcName: "Test Primary Health Center",
        lga: "Test LGA",
        state: "Test State",
        registrationCode: "TEST123",
        isActive: true,
      },
      { upsert: true, new: true },
    );

    console.log("✅ CHEW profile created");
    console.log("\n📝 Test credentials:");
    console.log("   Phone: 08134490997");
    console.log("   Password: " + process.env.TEST_USER_PASSWORD);
    console.log("   CHEW ID:", testUser._id);

    await mongoose.disconnect();
    console.log("\n✅ Setup complete!");
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

await createTestUser();
