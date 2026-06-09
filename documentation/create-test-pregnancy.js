import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./src/models/User.js";
import Pregnancy from "./src/models/Pregnancy.js";
import ANCPregnancy from "./src/models/ANCPregnancy.js";

dotenv.config();

async function createTestPregnancy() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to database");

    // Find the test CHEW user
    const chew = await User.findOne({ phone: "08012345678" });
    if (!chew) {
      console.log("❌ Test CHEW user not found");
      return;
    }

    console.log(`Found CHEW: ${chew.name} (${chew._id})`);

    // Create a test woman
    const woman = await User.findOneAndUpdate(
      { phone: "09012345678" },
      {
        name: "Test Woman",
        phone: "09012345678",
        address: "Test Address",
        role: "patient",
        consent: { sms: true, dataProcessing: true },
      },
      { upsert: true, new: true },
    );

    console.log(`Created/Found woman: ${woman.name} (${woman._id})`);

    // Calculate dates
    const lmp = new Date("2024-01-01");
    const edd = new Date("2024-10-08");
    const gestationalWeek = 28; // 28 weeks pregnant

    // Create pregnancy record
    const pregnancy = new Pregnancy({
      womanId: woman._id,
      chewId: chew._id,
      lmp: lmp,
      edd: edd,
      gestationalWeek: gestationalWeek,
      clinicName: "Test Clinic",
      registrationDate: new Date(),
      status: "active",
      lastCheckin: new Date(),
      ancVisits: [],
    });

    await pregnancy.save();
    console.log(`✅ Pregnancy created: ${pregnancy._id}`);

    // Create ANC tracking record
    const ancPregnancy = new ANCPregnancy({
      pregnancyId: pregnancy._id,
      fmohSchedule: generateSchedule(lmp),
    });

    await ancPregnancy.save();
    console.log(`✅ ANC Pregnancy record created`);

    console.log("\n📝 Test data created successfully!");
    console.log(`Woman Phone: 09012345678`);
    console.log(`CHEW Phone: 08012345678`);
    console.log(`Pregnancy ID: ${pregnancy._id}`);

    await mongoose.disconnect();
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

function generateSchedule(lmp) {
  const schedule = [];
  const milestones = [8, 12, 16, 20, 24, 28, 32, 36];

  milestones.forEach((week, index) => {
    const milestoneDate = new Date(lmp);
    milestoneDate.setDate(milestoneDate.getDate() + week * 7);

    schedule.push({
      weekNumber: week,
      milestoneNumber: index + 1,
      description: `ANC Visit ${index + 1}`,
      scheduledDate: milestoneDate,
      reminderSent: false,
      attended: false,
    });
  });

  return schedule;
}

await createTestPregnancy();
