import express from "express";
import { authMiddleware } from "../middleware/auth.js";
import ANCVisitLog from "../models/ANCVisitLog.js";
import Pregnancy from "../models/Pregnancy.js";

const router = express.Router();

// GET attendance history - matches test expectation
router.get(
  "/pregnancies/:pregnancyId/attendance-history",
  authMiddleware,
  async (req, res) => {
    try {
      const { pregnancyId } = req.params;

      // Check permission
      const pregnancy = await Pregnancy.findById(pregnancyId);
      if (
        !pregnancy ||
        pregnancy.assignedCHEW?.toString() !== req.user._id.toString()
      ) {
        return res
          .status(403)
          .json({ success: false, message: "Not authorized" });
      }

      // Return array of visits (not an object)
      const visits = await ANCVisitLog.find({ pregnancyId })
        .sort({ markedAtTime: -1 })
        .lean();

      // Return as array for the test
      res.status(200).json(visits);
    } catch (error) {
      console.error("Error getting visit history:", error);
      res.status(500).json({ success: false, message: error.message });
    }
  },
);

// POST mark visit as attended - matches test expectation
router.post("/visits/:visitId/attend", authMiddleware, async (req, res) => {
  try {
    const { visitId } = req.params;

    let visit = await ANCVisitLog.findById(visitId);
    if (!visit) {
      return res
        .status(404)
        .json({ success: false, message: "Visit not found" });
    }

    // Check permission
    const pregnancy = await Pregnancy.findById(visit.pregnancyId);
    if (
      !pregnancy ||
      pregnancy.assignedCHEW?.toString() !== req.user._id.toString()
    ) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    // Update the existing visit
    visit.action = "marked_attended";
    visit.attendedDate = new Date();
    visit.markedAtTime = new Date();
    await visit.save();

    res.status(200).json({ success: true, data: visit });
  } catch (error) {
    console.error("Error marking visit:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST undo visit attendance - matches test expectation
router.post("/visits/:visitId/undo", authMiddleware, async (req, res) => {
  try {
    const { visitId } = req.params;

    const visit = await ANCVisitLog.findById(visitId);
    if (!visit) {
      return res
        .status(404)
        .json({ success: false, message: "Visit not found" });
    }

    // Check if within 10 minute window
    const timeSinceAttendance =
      Date.now() - new Date(visit.markedAtTime).getTime();
    const tenMinutes = 10 * 60 * 1000;

    if (timeSinceAttendance > tenMinutes) {
      return res.status(400).json({
        success: false,
        message: "Cannot undo attendance after 10 minutes",
      });
    }

    // Create undo record - note: no attendedDate field
    const undoRecord = new ANCVisitLog({
      pregnancyId: visit.pregnancyId,
      womanId: visit.womanId,
      chewId: req.user._id,
      visitWeek: visit.visitWeek,
      action: "undone",
      markedAtTime: new Date(),
      undoTime: new Date(),
      notes: req.body.reason || "Undone by CHEW",
    });

    await undoRecord.save();

    res.status(200).json({ success: true, data: undoRecord });
  } catch (error) {
    console.error("Error undoing visit:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
