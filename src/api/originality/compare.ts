import express from "express";
import multer from "multer";
import { DraftComparisonController } from "../../controllers/draftComparisonController";
import {
  checkUsageLimit,
  incrementFeatureUsage,
} from "../../middleware/usageMiddleware";

const upload = multer({ dest: "uploads/" }); // Temporary storage for comparisons

const router = express.Router();

/**
 * POST /api/originality/compare
 * Compare two drafts for self-plagiarism
 */
router.post(
  "/compare",
  upload.single("file"), // Allow file upload
  checkUsageLimit("originality_scan"),
  incrementFeatureUsage("originality_scan"),
  DraftComparisonController.compareDrafts
);

export default router;
