"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const searchAlertService_1 = require("../../services/searchAlertService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = express_1.default.Router();
/**
 * GET /api/search-alerts
 * Get all search alerts for the current user
 */
router.get("/", async (req, res) => {
    try {
        const authReq = req;
        const userId = authReq.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const alerts = await searchAlertService_1.SearchAlertService.getAlerts(userId);
        return res.status(200).json(alerts);
    }
    catch (error) {
        logger_1.default.error("Error in GET /api/search-alerts", { error: error.message });
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
router.post("/", async (req, res) => {
    try {
        const authReq = req;
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
        const alert = await searchAlertService_1.SearchAlertService.createAlert(userId, query, frequency);
        return res.status(201).json(alert);
    }
    catch (error) {
        logger_1.default.error("Error in POST /api/search-alerts", { error: error.message });
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
router.patch("/:id", async (req, res) => {
    try {
        const authReq = req;
        const userId = authReq.user?.id;
        const id = req.params.id;
        const data = req.body;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const updatedAlert = await searchAlertService_1.SearchAlertService.updateAlert(userId, id, data);
        return res.status(200).json(updatedAlert);
    }
    catch (error) {
        logger_1.default.error("Error in PATCH /api/search-alerts/:id", { error: error.message, id: req.params.id });
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
router.delete("/:id", async (req, res) => {
    try {
        const authReq = req;
        const userId = authReq.user?.id;
        const id = req.params.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        await searchAlertService_1.SearchAlertService.deleteAlert(userId, id);
        return res.status(200).json({ success: true, message: "Search alert deleted" });
    }
    catch (error) {
        logger_1.default.error("Error in DELETE /api/search-alerts/:id", { error: error.message, id: req.params.id });
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
router.post("/:id/check", async (req, res) => {
    try {
        const authReq = req;
        const userId = authReq.user?.id;
        const id = req.params.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const response = await searchAlertService_1.SearchAlertService.checkAlert(userId, id);
        return res.status(200).json(response);
    }
    catch (error) {
        logger_1.default.error("Error in POST /api/search-alerts/:id/check", { error: error.message, id: req.params.id });
        return res.status(500).json({
            success: false,
            message: "Failed to check search alert",
        });
    }
});
exports.default = router;
