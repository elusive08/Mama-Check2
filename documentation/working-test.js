import axios from "axios";

const BASE_URL = "http://localhost:3000";
let authToken = null;

async function testEndpoint(
  name,
  method,
  url,
  data = null,
  requiresAuth = false,
) {
  try {
    console.log(`\n📝 ${name}`);
    const config = { method, url: `${BASE_URL}${url}`, data };

    if (requiresAuth && authToken) {
      config.headers = { Authorization: `Bearer ${authToken}` };
    }

    const response = await axios(config);
    console.log(`   ✅ ${response.status} - Success`);
    return response.data;
  } catch (error) {
    const status = error.response?.status || "ERROR";
    const message = error.response?.data?.error || error.message;
    console.log(`   ❌ ${status} - ${message}`);
    return null;
  }
}

async function runTests() {
  console.log("🚀 MamaCheck API Tests\n");
  console.log("=".repeat(50));

  // 1. Health check
  await testEndpoint("Health Check", "GET", "/health");

  // 2. Request OTP
  await testEndpoint("Request OTP", "POST", "/api/v1/auth/request-otp", {
    phone: "08012345678",
  });

  // 3. Verify OTP
  await testEndpoint("Verify OTP", "POST", "/api/v1/auth/verify-otp", {
    phone: "08012345678",
    otp: "123456",
  });

  // 4. Login
  const loginResult = await testEndpoint(
    "Login",
    "POST",
    "/api/v1/auth/login",
    {
      phone: "08012345678",
      password: "password123",
    },
  );

  if (loginResult && loginResult.accessToken) {
    authToken = loginResult.accessToken;
    console.log(`\n🔑 Got auth token: ${authToken.substring(0, 20)}...`);

    // 5. Get current user
    await testEndpoint(
      "Get Current User",
      "GET",
      "/api/v1/auth/me",
      null,
      true,
    );

    // 6. Get CHEW dashboard
    await testEndpoint(
      "CHEW Dashboard",
      "GET",
      "/api/v1/chew/dashboard",
      null,
      true,
    );

    // 7. Get assigned women
    await testEndpoint(
      "Assigned Women",
      "GET",
      "/api/v1/chew/women?page=1&limit=5",
      null,
      true,
    );

    // 8. Get red flags
    await testEndpoint(
      "Red Flags",
      "GET",
      "/api/v1/chew/red-flags",
      null,
      true,
    );

    // 9. Dashboard overview
    await testEndpoint(
      "Dashboard Overview",
      "GET",
      "/api/v1/dashboard/chew/overview",
      null,
      true,
    );
  }

  // 10. Simulate SMS
  await testEndpoint("Simulate SMS", "POST", "/api/v1/webhook/simulate-sms", {
    from: "08012345678",
    text: "1,2,3",
  });

  console.log("\n" + "=".repeat(50));
  console.log("\n✅ Tests completed!");
}

runTests();
