import express from "express";
import referenceDataController from "../controllers/referenceDataController.js";
import { authMiddleware, requireRole } from "../middleware/auth.js";

const router = express.Router();

// Public endpoints (no auth required for reads)
router.get("/lgas", (req, res) =>
  referenceDataController.getAllLGAs(req, res),
);
router.get("/states", (req, res) =>
  referenceDataController.getAllStates(req, res),
);
router.get("/lgas/state/:state", (req, res) =>
  referenceDataController.getLGAsByState(req, res),
);
router.get("/phcs/lga/:lga", (req, res) =>
  referenceDataController.getPHCsByLGA(req, res),
);
router.get("/phcs/state/:state", (req, res) =>
  referenceDataController.getPHCsByState(req, res),
);
router.get("/phcs/nearest", (req, res) =>
  referenceDataController.getNearestPHC(req, res),
);

// Admin only endpoints
router.post(
  "/lgas",
  authMiddleware,
  requireRole("admin"),
  (req, res) => referenceDataController.createLGA(req, res),
);

router.post(
  "/phcs",
  authMiddleware,
  requireRole("admin"),
  (req, res) => referenceDataController.createPHC(req, res),
);

router.put(
  "/lgas/:lgaId",
  authMiddleware,
  requireRole("admin"),
  (req, res) => referenceDataController.updateLGA(req, res),
);

router.put(
  "/phcs/:phcId",
  authMiddleware,
  requireRole("admin"),
  (req, res) => referenceDataController.updatePHC(req, res),
);

router.delete(
  "/lgas/:lgaId",
  authMiddleware,
  requireRole("admin"),
  (req, res) => referenceDataController.deleteLGA(req, res),
);

router.delete(
  "/phcs/:phcId",
  authMiddleware,
  requireRole("admin"),
  (req, res) => referenceDataController.deletePHC(req, res),
);

export default router;
