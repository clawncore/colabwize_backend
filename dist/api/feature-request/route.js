"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const featureRequestService_1 = require("../../services/featureRequestService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const auth_1 = require("../../middleware/auth");
const recaptcha_1 = require("../../utils/recaptcha");
const requestHelpers_1 = require("../../utils/requestHelpers");
const router = (0, express_1.Router)();
// Create a new feature request (public endpoint)
router.post("/simple", async (req, res) => {
    try {
        const { token, ...requestData } = req.body;
        // reCAPTCHA verification
        if (token) {
            const recaptchaResult = await (0, recaptcha_1.verifyRecaptcha)(token);
            if (!recaptchaResult.success) {
                return res.status(403).json({
                    success: false,
                    message: recaptchaResult.message ||
                        "Automated activity detected. Please try again.",
                });
            }
        }
        // Validate required fields
        if (!requestData.title || !requestData.description) {
            return res.status(400).json({
                success: false,
                message: "Title and description are required",
            });
        }
        // User ID is optional (can be null for anonymous requests)
        const userId = req.user?.id || null;
        const validCategories = [
            "ui",
            "functionality",
            "performance",
            "content",
            "other",
        ];
        if (requestData.category &&
            !validCategories.includes(requestData.category)) {
            return res.status(400).json({
                success: false,
                message: "Invalid category",
            });
        }
        const validPriorities = [
            "low",
            "nice-to-have",
            "medium",
            "high",
            "critical",
        ];
        if (requestData.priority &&
            !validPriorities.includes(requestData.priority)) {
            return res.status(400).json({
                success: false,
                message: "Invalid priority level",
            });
        }
        const request = await featureRequestService_1.FeatureRequestService.createFeatureRequest({
            user_id: userId,
            title: requestData.title,
            description: requestData.description,
            category: requestData.category || "other",
            priority: requestData.priority || "nice-to-have",
        });
        return res.json({
            success: true,
            message: "Feature request created successfully",
            featureRequestId: request.id,
        });
    }
    catch (error) {
        logger_1.default.error("Error creating feature request:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create feature request",
        });
    }
});
// Get all feature requests
router.get("/", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        // User ID will be attached by the authentication middleware in main-server.ts
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }
        const { category, status, priority, limit } = req.query;
        const filters = {};
        if (category)
            filters.category = (0, requestHelpers_1.getSafeString)(category);
        if (status)
            filters.status = (0, requestHelpers_1.getSafeString)(status);
        if (priority)
            filters.priority = (0, requestHelpers_1.getSafeString)(priority);
        const requests = await featureRequestService_1.FeatureRequestService.getFeatureRequests(filters, limit ? parseInt((0, requestHelpers_1.getSafeString)(limit) || "50") : 50);
        return res.json({ success: true, requests });
    }
    catch (error) {
        logger_1.default.error("Error fetching feature requests:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch feature requests",
        });
    }
});
// Get a specific feature request by ID
router.get("/:id", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { id } = req.params;
        // User ID will be attached by the authentication middleware in main-server.ts
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }
        const request = await featureRequestService_1.FeatureRequestService.getFeatureRequestById(id);
        if (!request) {
            return res.status(404).json({
                success: false,
                message: "Feature request not found",
            });
        }
        return res.json({ success: true, request });
    }
    catch (error) {
        logger_1.default.error("Error fetching feature request by ID:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch feature request",
        });
    }
});
// Vote for a feature request
router.post("/:id/vote", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { id } = req.params;
        // User ID will be attached by the authentication middleware in main-server.ts
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }
        const request = await featureRequestService_1.FeatureRequestService.voteForFeature(id, userId);
        return res.json({
            success: true,
            message: "Vote added successfully",
            votes: request.votes,
        });
    }
    catch (error) {
        if (error.message === "User has already voted for this feature") {
            return res.status(400).json({
                success: false,
                message: "User has already voted for this feature",
            });
        }
        logger_1.default.error("Error voting for feature:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to vote for feature",
        });
    }
});
// Update feature request status (admin only)
router.patch("/:id/status", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        if (!status) {
            return res.status(400).json({
                success: false,
                message: "Status is required",
            });
        }
        const validStatuses = [
            "open",
            "planned",
            "in_progress",
            "implemented",
            "closed",
        ];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status",
            });
        }
        // User ID will be attached by the authentication middleware in main-server.ts
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }
        const request = await featureRequestService_1.FeatureRequestService.updateFeatureStatus(userId, id, status);
        return res.json({ success: true, request });
    }
    catch (error) {
        if (error.message === "Only administrators can update feature status") {
            return res.status(403).json({
                success: false,
                message: "Access denied. Admin privileges required.",
            });
        }
        logger_1.default.error("Error updating feature status:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update feature status",
        });
    }
});
exports.default = router;
