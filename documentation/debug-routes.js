import express from "express";

// Just to see what routes your app actually has
const app = express();
app.disable("x-powered-by");

// Log all registered routes
function printRoutes(app) {
  console.log("\n📋 Registered Routes:\n");

  function printRoute(path, layer) {
    if (layer.route) {
      // Routes registered directly on the app
      const methods = Object.keys(layer.route.methods).join(", ").toUpperCase();
      console.log(`   ${methods.padEnd(7)} ${path}${layer.route.path}`);
    } else if (layer.name === "router" && layer.handle.stack) {
      // Router middleware
      const basePath =
        path +
        (layer.regexp.source
          .replaceAll("\\", "")
          .replaceAll("^", "")
          .replaceAll("?", "")
          .replaceAll("([", ":")
          .replaceAll("])?", "") || "");
      layer.handle.stack.forEach((subLayer) => {
        if (subLayer.route) {
          const methods = Object.keys(subLayer.route.methods)
            .join(", ")
            .toUpperCase();
          console.log(
            `   ${methods.padEnd(7)} ${basePath}${subLayer.route.path}`,
          );
        }
      });
    }
  }

  app._router.stack.forEach((layer) => printRoute("", layer));
}

// This won't show actual routes, but you can manually check your server.js

console.log("🔍 Checking your server configuration...");
console.log("\n1. Make sure your server.js has something like:\n");
console.log('   app.use("/api/v1", authRoutes)');
console.log('   app.use("/api/v1", pregnancyRoutes)');
console.log('   app.use("/health", (req, res) => res.json({status: "ok"}))');
console.log("\n2. Check your actual server.js file:\n");
