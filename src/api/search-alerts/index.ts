import express, { Request, Response } from "express";
import { SearchAlertService } from "../../services/searchAlertService";
import logger from "../../monitoring/logger";

const router = express.Router();

interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email: string;
    };
}

/**
 * GET /api/search-alerts
 * Get all search alerts for the current user
 */
router.get("/", async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        const alerts = await SearchAlertService.getAlerts(userId);
        return res.status(200).json(alerts);
    } catch (error: any) {
        logger.error("Error in GET /api/search-alerts", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to fetch search alerts",
        });
    }
});

/**
 * POST /api/search-alerts
 * Create a new search alert
 */
router.post("/", async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.id;
        const { query, frequency } = req.body;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        if (!query || !frequency) {
            return res.status(400).json({
                success: false,
                message: "Query and frequency are required",
            });
        }

        const alert = await SearchAlertService.createAlert(userId, query, frequency);
        return res.status(201).json(alert);
    } catch (error: any) {
        logger.error("Error in POST /api/search-alerts", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to create search alert",
        });
    }
});

/**
 * PATCH /api/search-alerts/:id
 * Update a search alert
 */
router.patch("/:id", async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.id;
        const id = req.params.id as string;
        const data = req.body;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        const updatedAlert = await SearchAlertService.updateAlert(userId, id, data);
        return res.status(200).json(updatedAlert);
    } catch (error: any) {
        logger.error("Error in PATCH /api/search-alerts/:id", { error: error.message, id: req.params.id });
        return res.status(500).json({
            success: false,
            message: "Failed to update search alert",
        });
    }
});

/**
 * DELETE /api/search-alerts/:id
 * Delete a search alert
 */
router.delete("/:id", async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.id;
        const id = req.params.id as string;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        await SearchAlertService.deleteAlert(userId, id);
        return res.status(200).json({ success: true, message: "Search alert deleted" });
    } catch (error: any) {
        logger.error("Error in DELETE /api/search-alerts/:id", { error: error.message, id: req.params.id });
        return res.status(500).json({
            success: false,
            message: "Failed to delete search alert",
        });
    }
});

/**
 * POST /api/search-alerts/:id/check
 * Manually check a search alert for new matches
 */
router.post("/:id/check", async (req: Request, res: Response) => {
    try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.user?.id;
        const id = req.params.id as string;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        const response = await SearchAlertService.checkAlert(userId, id);
        return res.status(200).json(response);
    } catch (error: any) {
        logger.error("Error in POST /api/search-alerts/:id/check", { error: error.message, id: req.params.id });
        return res.status(500).json({
            success: false,
            message: "Failed to check search alert",
        });
    }
});

export default router;
