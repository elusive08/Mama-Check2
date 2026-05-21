import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("🔍 Discovering API Endpoints...\n");

// Read routes directory
const routesDir = path.join(__dirname, "src/routes");
if (fs.existsSync(routesDir)) {
  const routeFiles = fs.readdirSync(routesDir);

  routeFiles.forEach((file) => {
    if (file.endsWith(".js")) {
      console.log(`📁 ${file}:`);
      const content = fs.readFileSync(path.join(routesDir, file), "utf8");

      // Extract routes
      const routeMatches = content.matchAll(
        /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g,
      );
      for (const match of routeMatches) {
        console.log(
          `   ${match[1].toUpperCase()} /api/v1/${file.replace(".js", "")}${match[2]}`,
        );
      }
    }
  });
} else {
  console.log("Routes directory not found!");
}

// Also check server.js for base path
console.log("\n📋 Check your server.js for the base API path:");
const serverContent = fs.readFileSync("server.js", "utf8");
const apiMatches = serverContent.matchAll(
  /app\.use\s*\(\s*['"`]([^'"`]+)['"`]/g,
);
for (const match of apiMatches) {
  console.log(`   Base path: ${match[1]}`);
}
