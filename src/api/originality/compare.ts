import express, { Request, Response } from "express";
import multer from "multer";
import { DraftComparisonController } from "../../controllers/draftComparisonController";
import { BillingError } from "../../billing/BillingGateway";

const upload = multer({ dest: "uploads/" }); // Temporary storage for comparisons

const router = express.Router();

/**
 * POST /api/originality/compare
 * Compare two drafts for self-plagiarism. Metered under originality_scan
 * quota through the single billing pipeline (hold → execute → confirm/release).
 * The old checkUsageLimit + incrementFeatureUsage chain double-consumed.
 */
router.post(
  "/compare",
  upload.single("file"), // Allow file upload
  async (req: Request, res: Response) => {
    try {
      const userId = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, message: "Authentication required" });
      }

      // ── Originality billing disabled per request (code preserved) ──
      // await BillingGateway.withFeature(
      //   userId,
      //   "originality_scan",
      //   undefined,
      //   () => DraftComparisonController.compareDrafts(req, res),
      // );
      await DraftComparisonController.compareDrafts(req, res);
    } catch (e: any) {
      if (e instanceof BillingError) {
        const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
        return res.status(status).json({
          success: false,
          message: e.message || "Plan limit reached",
          code: e.code,
        
        ...e.data,
    });
      }
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          message: e.message || "Failed to compare drafts",
        });
      }
    }
  },
);

export default router;
