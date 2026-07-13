"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const logger_1 = __importDefault(require("../../monitoring/logger"));
const originalityMapService_1 = require("../../services/originalityMapService");
const router = express_1.default.Router();
/**
 * POST /api/originality/webhook/copyleaks/{status}
 * Webhook handler for Copyleaks async results
 */
router.post("/copyleaks/:status", async (req, res) => {
    try {
        const { status } = req.params;
        const payload = req.body;
        // Copyleaks sends headers to verify origin, but for now we'll rely on the scanId validity
        // The developerPayload we sent contains the scanId
        logger_1.default.info(`Received Copyleaks webhook: ${status}`, {
            scanId: payload.developerPayload ? JSON.parse(payload.developerPayload).scanId : 'unknown'
        });
        if (status === "completed") {
            // Extract Scan ID from developer payload
            let scanId = "";
            if (payload.developerPayload) {
                try {
                    const data = JSON.parse(payload.developerPayload);
                    scanId = data.scanId;
                }
                catch (e) {
                    logger_1.default.error("Failed to parse developerPayload", { error: e });
                }
            }
            if (scanId) {
                // Process the successful scan result
                await originalityMapService_1.OriginalityMapService.processCopyleaksResult(scanId, payload);
            }
        }
        else if (status === "error") {
            logger_1.default.error("Copyleaks scan failed", { payload });
            // Handle failure (update DB status to failed)
        }
        // Always modify 200 OK to acknowledge receipt
        return res.status(200).send();
    }
    catch (error) {
        logger_1.default.error("Error processing Copyleaks webhook", { error: error.message });
        return res.status(500).send();
    }
});
exports.default = router;
