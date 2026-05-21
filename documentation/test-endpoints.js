import axios from "axios";

const BASE_URL = "http://localhost:3000";
let authToken = null;

async function getAuthToken() {
  try {
    const response = await axios.post(`${BASE_URL}/api/v1/auth/login`, {
      phone: "08012345678", // Working CHEW phone
      password: "password123",
    });
    return response.data.token;
  } catch (error) {
    console.error("Failed to get token:", error.response?.data?.error);
    return null;
  }
}

async function testEndpoint(
  name,
  method,
  url,
  data = null,
  requiresAuth = false,
) {
  try {
    console.log(`\n📝 Testing: ${name}`);
    console.log(`   ${method} ${url}`);

    const config = {
      method,
      url: `${BASE_URL}${url}`,
      data,
      headers: {},
    };

    if (requiresAuth && authToken) {
      config.headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await axios(config);
    console.log(`   ✅ SUCCESS - Status: ${response.status}`);
    if (response.data) {
      console.log(
        `   Response:`,
        JSON.stringify(response.data).substring(0, 150),
      );
    }
    return response.data;
  } catch (error) {
    const status = error.response?.status || "No response";
    const message = error.response?.data?.error || error.message;
    console.log(`   ❌ FAILED - Status: ${status}`);
    console.log(`   Error: ${message}`);
    return null;
  }
}

async function runTests() {
  console.log("🚀 Testing MamaCheck API - Correct Endpoints\n");
  console.log("=".repeat(60));

  // 1. Health Check
  await testEndpoint("Health Check", "GET", "/health");

  // 2. Get auth token
  console.log("\n🔐 Getting auth token...");
  authToken = await getAuthToken();
  if (!authToken) {
    console.log("❌ Cannot proceed without auth token");
    return;
  }
  console.log(`   ✅ Token obtained: ${authToken.substring(0, 30)}...`);

  // 3. Protected endpoints
  await testEndpoint("Get Current User", "GET", "/api/v1/auth/me", null, true);
  await testEndpoint(
    "CHEW Dashboard",
    "GET",
    "/api/v1/chew/dashboard",
    null,
    true,
  );
  await testEndpoint(
    "Assigned Women",
    "GET",
    "/api/v1/chew/women?page=1&limit=10",
    null,
    true,
  );
  await testEndpoint("Red Flags", "GET", "/api/v1/chew/red-flags", null, true);
  await testEndpoint(
    "Dashboard Overview",
    "GET",
    "/api/v1/dashboard/chew/overview",
    null,
    true,
  );
  await testEndpoint(
    "Weekly Summary",
    "GET",
    "/api/v1/dashboard/chew/weekly-summary",
    null,
    true,
  );

  // 4. Webhook endpoint (using the patient's phone)
  await testEndpoint("Simulate SMS", "POST", "/api/v1/webhook/simulate-sms", {
    from: "09134490997", // This is the test patient woman's phone
    text: "1,2,3",
  });

  console.log("\n" + "=".repeat(60));
  console.log("\n✅ Test complete!\n");
}

await runTests();
