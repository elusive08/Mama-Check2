import express from "express";
import authRoutes from "./auth.js";
import pregnancyRoutes from "./pregnancies.js";
import dashboardRoutes from "./dashboard.js";
import chewRoutes from "./chew.js";
import webhookRoutes from "./webhook.js";
import referenceRoutes from "./reference.js";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/pregnancies", pregnancyRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/chew", chewRoutes);
router.use("/webhook", webhookRoutes);
router.use("/reference", referenceRoutes);

// API info endpoint
router.get("/", (req, res) => {
  res.json({
    name: "MamaCheck API",
    version: "1.0.0",
    endpoints: {
      auth: "/api/v1/auth",
      pregnancies: "/api/v1/pregnancies",
      dashboard: "/api/v1/dashboard",
      chew: "/api/v1/chew",
      webhook: "/api/v1/webhook",
      reference: "/api/v1/reference",
    },
  });
});

export default router;
