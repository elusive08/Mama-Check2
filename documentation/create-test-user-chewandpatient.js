import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./src/models/User.js";
import Pregnancy from "./src/models/Pregnancy.js";
import ANCPregnancy from "./src/models/ANCPregnancy.js";
import CHEWProfile from "./src/models/CHEWProfile.js";

dotenv.config();

async function createTestData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("✅ Connected to database");

    // 1. Create/Find CHEW user (healthcare worker)
    let chew = await User.findOne({ phone: "08012345678" });
    if (!chew) {
      chew = await User.create({
        name: "Test CHEW Worker",
        phone: "08012345678",
        password: process.env.TEST_USER_PASSWORD, // Will be hashed by middleware
        role: "chew", // CHEW role
        preferredLanguage: "en",
        consent: { sms: true, dataProcessing: true },
      });
      console.log(`✅ Created CHEW user: ${chew._id}`);

      // Create CHEW profile
      await CHEWProfile.create({
        userId: chew._id,
        phcId: "PHC001",
        phcName: "Test Primary Health Center",
        lga: "Test LGA",
        state: "Test State",
        registrationCode: "TEST123",
        isActive: true,
      });
      console.log("✅ CHEW profile created");
    } else {
      console.log(`✅ Found existing CHEW: ${chew.name} (${chew._id})`);
    }

    // 2. Create/Find Patient (pregnant woman) - NOT a CHEW!
    const patient = await User.findOneAndUpdate(
      { phone: "08134490997" },
      {
        name: "Test Pregnant Woman",
        phone: "08134490997",
        address: "Test Address",
        role: "patient", // ← This should be "patient", NOT "chew"
        preferredLanguage: "en",
        consent: { sms: true, dataProcessing: true },
      },
      { upsert: true, new: true },
    );
    console.log(
      `✅ Created/Found Patient: ${patient.name} (${patient._id}) - Role: ${patient.role}`,
    );

    // 3. Create pregnancy for the patient (assigned to CHEW)
    let pregnancy = await Pregnancy.findOne({ womanId: patient._id });

    if (!pregnancy) {
      const lmp = new Date("2024-01-01");
      const edd = new Date("2024-10-08");
      const gestationalWeek = 28;

      pregnancy = new Pregnancy({
        womanId: patient._id,
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
      console.log(`✅ Created pregnancy: ${pregnancy._id}`);

      // Create ANC tracking record
      const ancPregnancy = new ANCPregnancy({
        pregnancyId: pregnancy._id,
        fmohSchedule: generateSchedule(lmp),
      });

      await ancPregnancy.save();
      console.log(`✅ ANC Pregnancy record created`);
    } else {
      console.log(`✅ Pregnancy already exists: ${pregnancy._id}`);
    }

    console.log("\n📝 Test Data Summary:");
    console.log("=".repeat(40));
    console.log("👩‍⚕️ CHEW (Healthcare Worker):");
    console.log(`   Phone: 08012345678`);
    console.log(`   Role: ${chew.role}`);
    console.log(`   Use this to login to dashboard\n`);
    console.log("🤰 PATIENT (Pregnant Woman):");
    console.log(`   Phone: 08134490997`);
    console.log(`   Role: ${patient.role}`);
    console.log(`   Use this to send SMS symptoms\n`);
    console.log("📱 Test SMS Command:");
    console.log(
      `   curl -X POST http://localhost:3000/api/v1/webhook/simulate-sms \\`,
    );
    console.log(`     -H "Content-Type: application/json" \\`);
    console.log(`     -d '{"from":"08134490997","text":"1,2,3"}'`);

    await mongoose.disconnect();
    console.log("\n✅ Setup complete!");
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

await createTestData();
