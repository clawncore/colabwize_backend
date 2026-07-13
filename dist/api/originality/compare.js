"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const draftComparisonController_1 = require("../../controllers/draftComparisonController");
const BillingGateway_1 = require("../../billing/BillingGateway");
const upload = (0, multer_1.default)({ dest: "uploads/" }); // Temporary storage for comparisons
const router = express_1.default.Router();
/**
 * POST /api/originality/compare
 * Compare two drafts for self-plagiarism. Metered under originality_scan
 * quota through the single billing pipeline (hold → execute → confirm/release).
 * The old checkUsageLimit + incrementFeatureUsage chain double-consumed.
 */
router.post("/compare", upload.single("file"), // Allow file upload
async (req, res) => {
    try {
        const userId = req.user?.id;
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
        await draftComparisonController_1.DraftComparisonController.compareDrafts(req, res);
    }
    catch (e) {
        if (e instanceof BillingGateway_1.BillingError) {
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
});
exports.default = router;
