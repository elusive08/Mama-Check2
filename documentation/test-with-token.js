import axios from "axios";

const BASE_URL = "http://localhost:3000";

async function testAPI() {
  try {
    console.log("🔐 Logging in...\n");

    // Login
    const loginResponse = await axios.post(`${BASE_URL}/api/v1/auth/login`, {
      phone: "08134490997",
      password: process.env.TEST_USER_PASSWORD,
    });

    // Fix: Use 'token' instead of 'accessToken'
    const token = loginResponse.data.token;

    if (!token) {
      console.error(
        "❌ No token received. Login response:",
        loginResponse.data,
      );
      return;
    }

    console.log("✅ Login successful!");
    console.log(`📝 Token: ${token.substring(0, 50)}...\n`);

    // Test CHEW dashboard
    console.log("📊 Testing CHEW Dashboard...");
    try {
      const dashboard = await axios.get(`${BASE_URL}/api/v1/chew/dashboard`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      console.log(
        "✅ Dashboard response:",
        JSON.stringify(dashboard.data, null, 2).substring(0, 200),
      );
    } catch (error) {
      console.log(
        "⚠️ Dashboard error:",
        error.response?.data?.error || error.message,
      );
    }

    // Test assigned women
    console.log("\n👩 Testing Assigned Women...");
    try {
      const women = await axios.get(
        `${BASE_URL}/api/v1/chew/women?page=1&limit=5`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      console.log(
        "✅ Assigned women:",
        women.data.data?.length || 0,
        "women found",
      );
    } catch (error) {
      console.log(
        "⚠️ Assigned women error:",
        error.response?.data?.error || error.message,
      );
    }

    // Test dashboard overview
    console.log("\n📈 Testing Dashboard Overview...");
    try {
      const overview = await axios.get(
        `${BASE_URL}/api/v1/dashboard/chew/overview`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      console.log(
        "✅ Overview:",
        JSON.stringify(overview.data, null, 2).substring(0, 300),
      );
    } catch (error) {
      console.log(
        "⚠️ Overview error:",
        error.response?.data?.error || error.message,
      );
    }

    console.log("\n🎉 Tests completed!");
  } catch (error) {
    console.error("❌ Error:", error.response?.data || error.message);
  }
}

await testAPI();
