import express, { Request, Response } from "express";
import axios from "axios";
import logger from "../../monitoring/logger";

const router = express.Router();

// Configuration
// In production, these should come from process.env
const UNSPLASH_API_URL = process.env.REACT_APP_UNSPLASH_API_URL || "https://api.unsplash.com";
const UNSPLASH_ACCESS_KEY = process.env.REACT_APP_UNSPLASH_ACCESS_KEY;

/**
 * GET /api/integrations/unsplash/search
 * Proxy for Unsplash Search
 */
router.get("/search", async (req: Request, res: Response) => {
    try {
        if (!UNSPLASH_ACCESS_KEY) {
            logger.error("Unsplash API key is missing in backend configuration");
            return res.status(503).json({
                success: false,
                code: "IMAGE_PROVIDER_UNAVAILABLE",
                message: "Image search service is currently unavailable (Config Error)."
            });
        }

        const query = req.query.query as string;
        const page = req.query.page || 1;
        const per_page = req.query.per_page || 12;

        if (!query) {
            return res.status(400).json({
                success: false,
                message: "Search query is required"
            });
        }

        // Proxy request to Unsplash
        const response = await axios.get(`${UNSPLASH_API_URL}/search/photos`, {
            params: { query, page, per_page },
            headers: {
                "Authorization": `Client-ID ${UNSPLASH_ACCESS_KEY}`,
                "Accept-Version": "v1"
            }
        });

        return res.status(200).json({
            success: true,
            data: response.data
        });

    } catch (error: any) {
        // Safe Error Handling & Logging
        const status = error.response?.status || 500;
        const unsplashError = error.response?.data?.errors?.[0] || error.message;

        logger.error("Unsplash Proxy Error", {
            status,
            error: unsplashError,
            query: req.query.query
        });

        // Map Rate Limits
        if (status === 429) {
            return res.status(429).json({
                success: false,
                code: "IMAGE_RATE_LIMIT",
                message: "Image search limit reached. Please try again later."
            });
        }

        // Generic Provider Failure (Safe for UI)
        return res.status(503).json({
            success: false,
            code: "IMAGE_PROVIDER_UNAVAILABLE",
            message: "Unable to load images from provider."
        });
    }
});

/**
 * GET /api/integrations/unsplash/download
 * Proxy for Unsplash Download Tracking (Attempting to follow Unsplash API Guidelines)
 * Unsplash requires hitting a specific download endpoint to increment stats.
 */
router.get("/download", async (req: Request, res: Response) => {
    try {
        const downloadLocation = req.query.url as string;

        if (!downloadLocation) {
            return res.status(400).json({ success: false, message: "Download URL required" });
        }

        // Fire and forget - just need to hit the endpoint with the key
        await axios.get(downloadLocation, {
            headers: {
                "Authorization": `Client-ID ${UNSPLASH_ACCESS_KEY}`
            }
        });

        return res.status(200).json({ success: true });

    } catch (error: any) {
        // Non-critical endpoint, just log
        logger.warn("Unsplash Download Track Failed", { error: error.message });
        return res.status(200).json({ success: true }); // Pretend success to not block user
    }
});

export default router;
