import express, { Request, Response } from "express";
import logger from "../../monitoring/logger";
import { OriginalityMapService } from "../../services/originalityMapService";

const router = express.Router();

/**
 * POST /api/originality/webhook/copyleaks/{status}
 * Webhook handler for Copyleaks async results
 */
router.post("/copyleaks/:status", async (req: Request, res: Response) => {
    try {
        const { status } = req.params;
        const payload = req.body;

        // Copyleaks sends headers to verify origin, but for now we'll rely on the scanId validity
        // The developerPayload we sent contains the scanId

        logger.info(`Received Copyleaks webhook: ${status}`, {
            scanId: payload.developerPayload ? JSON.parse(payload.developerPayload).scanId : 'unknown'
        });

        if (status === "completed") {
            // Extract Scan ID from developer payload
            let scanId = "";
            if (payload.developerPayload) {
                try {
                    const data = JSON.parse(payload.developerPayload);
                    scanId = data.scanId;
                } catch (e) {
                    logger.error("Failed to parse developerPayload", { error: e });
                }
            }

            if (scanId) {
                // Process the successful scan result
                await OriginalityMapService.processCopyleaksResult(scanId, payload);
            }
        } else if (status === "error") {
            logger.error("Copyleaks scan failed", { payload });
            // Handle failure (update DB status to failed)
        }

        // Always modify 200 OK to acknowledge receipt
        return res.status(200).send();
    } catch (error: any) {
        logger.error("Error processing Copyleaks webhook", { error: error.message });
        return res.status(500).send();
    }
});

export default router;
