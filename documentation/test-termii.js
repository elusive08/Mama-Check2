import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

async function testTermii() {
  console.log("🔧 Testing Termii API Connection\n");

  const apiKey = process.env.TERMII_API_KEY;
  const senderId = process.env.TERMII_SENDER_ID || "MamaCheck";

  if (!apiKey) {
    console.log("❌ TERMII_API_KEY not found in .env file");
    console.log("Please add: TERMII_API_KEY=your_actual_key");
    return;
  }

  console.log(`API Key: ${apiKey.substring(0, 8)}...`);
  console.log(`Sender ID: ${senderId}`);

  // Test with a simple request to check API key validity
  try {
    const response = await axios.get("https://api.termii.com/api/get-sender", {
      params: { api_key: apiKey },
    });

    console.log("\n✅ Termii API key is valid!");
    console.log("Response:", response.data);
  } catch (error) {
    console.log(
      "\n❌ Termii API key error:",
      error.response?.data || error.message,
    );
    console.log("\n💡 Possible fixes:");
    console.log("1. Check your API key is correct");
    console.log("2. Ensure your Termii account has SMS credit");
    console.log("3. Verify sender ID is approved");
    console.log("4. For testing, set TERMII_API_KEY=test_mode to bypass");
  }
}

await testTermii();
