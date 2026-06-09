import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "./src/models/User.js";

dotenv.config();

async function checkUser() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    const user = await User.findOne({ phone: "08134490997" });
    if (user) {
      console.log("User found:");
      console.log("  Name:", user.name);
      console.log("  Phone:", user.phone);
      console.log("  Role:", user.role);
      console.log("  Password stored:", user.password);
      console.log("  Password length:", user.password?.length);
    } else {
      console.log("User not found");
    }
    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

await checkUser();
