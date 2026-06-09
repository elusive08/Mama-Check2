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

    // Create or find the CHEW with phone 08134490997
    const chew = await User.findOneAndUpdate(
      { phone: "08134490997" },
      {
        name: "Test CHEW Mama",
        phone: "08134490997",
        password: "password123",
        address: "Test Address",
        role: "chew",
        preferredLanguage: "en",
        consent: { sms: true, dataProcessing: true },
      },
      { upsert: true, new: true },
    );

    console.log(`✅ Created/Found CHEW: ${chew.name} (${chew._id})`);

    // Create CHEW profile if it doesn't exist
    const chewProfile = await CHEWProfile.findOneAndUpdate(
      { userId: chew._id },
      {
        userId: chew._id,
        phcId: "PHC002",
        phcName: "Test PHC Mama",
        lga: "Test LGA",
        state: "Test State",
        registrationCode: "TEST456",
        isActive: true,
      },
      { upsert: true, new: true },
    );

    console.log(`✅ CHEW profile created: ${chewProfile._id}`);

    // Now create a test patient woman
    const woman = await User.findOneAndUpdate(
      { phone: "09134490997" },
      {
        name: "Test Patient Woman",
        phone: "09134490997",
        address: "Test Address",
        role: "patient",
        preferredLanguage: "en",
        consent: { sms: true, dataProcessing: true },
      },
      { upsert: true, new: true },
    );

    console.log(`✅ Created/Found patient woman: ${woman.name} (${woman._id})`);

    // Check if pregnancy already exists
    let pregnancy = await Pregnancy.findOne({ womanId: woman._id });

    if (pregnancy) {
      console.log(`✅ Pregnancy already exists: ${pregnancy._id}`);
    } else {
      // Calculate dates
      const lmp = new Date("2024-01-01");
      const edd = new Date("2024-10-08");
      const gestationalWeek = 28; // 28 weeks pregnant

      // Create pregnancy record
      pregnancy = new Pregnancy({
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
      console.log(`✅ Created pregnancy: ${pregnancy._id}`);

      // Create ANC tracking record
      const ancPregnancy = new ANCPregnancy({
        pregnancyId: pregnancy._id,
        fmohSchedule: generateSchedule(lmp),
      });

      await ancPregnancy.save();
      console.log(`✅ ANC Pregnancy record created`);
    }

    console.log("\n📝 Test data ready!");
    console.log(`CHEW Phone: 08134490997`);
    console.log(`CHEW ID: ${chew._id}`);
    console.log(`Patient Phone: 09134490997`);
    console.log(`Pregnancy ID: ${pregnancy._id}`);
    console.log(`\nYou can now test with:`);
    console.log(`\n1. Login as CHEW:`);
    console.log(`  curl -X POST http://localhost:3000/api/v1/auth/login \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -d '{"phone":"08134490997","password":"password123"}'`);
    console.log(`\n2. Test SMS from patient:`);
    console.log(
      `  curl -X POST http://localhost:3000/api/v1/webhook/simulate-sms \\`,
    );
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -d '{"from":"09134490997","text":"1,2,3"}'`);

    await mongoose.disconnect();
    console.log("\n✅ Done!");
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
