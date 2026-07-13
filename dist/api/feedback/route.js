"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const feedbackService_1 = require("../../services/feedbackService");
const auth_1 = require("../../middleware/auth");
const recaptcha_1 = require("../../utils/recaptcha");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = (0, express_1.Router)();
// Create a new feedback item (public endpoint for feature requests)
router.post("/public", async (req, res) => {
    try {
        const { token, ...feedbackData } = req.body;
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
        if (!feedbackData.type ||
            !feedbackData.title ||
            !feedbackData.description) {
            return res.status(400).json({
                success: false,
                message: "Type, title, and description are required",
            });
        }
        const validTypes = ["feedback", "bug_report", "feature_request"];
        if (!validTypes.includes(feedbackData.type)) {
            return res.status(400).json({
                success: false,
                message: "Invalid feedback type",
            });
        }
        // For public endpoint, only allow feature requests
        if (feedbackData.type !== "feature_request") {
            return res.status(400).json({
                success: false,
                message: "Public endpoint only accepts feature requests",
            });
        }
        const validPriorities = ["low", "medium", "high", "critical"];
        if (feedbackData.priority &&
            !validPriorities.includes(feedbackData.priority)) {
            return res.status(400).json({
                success: false,
                message: "Invalid priority level",
            });
        }
        const feedback = await feedbackService_1.FeedbackService.createFeedback({
            user_id: null, // Public submission has no user ID
            type: feedbackData.type,
            category: feedbackData.category || null,
            priority: feedbackData.priority || "medium",
            title: feedbackData.title,
            description: feedbackData.description,
            status: "open",
            attachment_urls: feedbackData.attachment_urls || [],
            browser_info: feedbackData.browser_info || null,
            os_info: feedbackData.os_info || null,
            screen_size: feedbackData.screen_size || null,
            user_plan: feedbackData.user_plan || null,
            admin_notes: feedbackData.admin_notes || null,
        });
        return res.json({ success: true, feedback });
    }
    catch (error) {
        logger_1.default.error("Error creating public feedback:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create feedback",
        });
    }
});
// Apply authentication middleware to all subsequent routes
router.use(auth_1.authenticateExpressRequest);
// Create a new feedback item
router.post("/", async (req, res) => {
    try {
        // User ID will be attached by the authentication middleware in main-server.ts
        const userId = req.user?.id;
        const feedbackData = req.body;
        // Validate required fields
        if (!feedbackData.type ||
            !feedbackData.title ||
            !feedbackData.description) {
            return res.status(400).json({
                success: false,
                message: "Type, title, and description are required",
            });
        }
        const validTypes = ["feedback", "bug_report", "feature_request"];
        if (!validTypes.includes(feedbackData.type)) {
            return res.status(400).json({
                success: false,
                message: "Invalid feedback type",
            });
        }
        const validPriorities = ["low", "medium", "high", "critical"];
        if (feedbackData.priority &&
            !validPriorities.includes(feedbackData.priority)) {
            return res.status(400).json({
                success: false,
                message: "Invalid priority level",
            });
        }
        const feedback = await feedbackService_1.FeedbackService.createFeedback({
            user_id: userId || null,
            type: feedbackData.type,
            category: feedbackData.category || null,
            priority: feedbackData.priority || "medium",
            title: feedbackData.title,
            description: feedbackData.description,
            status: "open",
            attachment_urls: feedbackData.attachment_urls || [],
            browser_info: feedbackData.browser_info || null,
            os_info: feedbackData.os_info || null,
            screen_size: feedbackData.screen_size || null,
            user_plan: feedbackData.user_plan || null,
            admin_notes: feedbackData.admin_notes || null,
        });
        return res.json({ success: true, feedback });
    }
    catch (error) {
        logger_1.default.error("Error creating feedback:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create feedback",
        });
    }
});
// Get feedback items (admin only for all feedback, users see their own)
router.get("/", async (req, res) => {
    try {
        // User ID will be attached by the authentication middleware in main-server.ts
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }
        const { type, category, status, priority, limit } = req.query;
        const filters = {};
        if (type)
            filters.type = type;
        if (category)
            filters.category = category;
        if (status)
            filters.status = status;
        if (priority)
            filters.priority = priority;
        const feedbackItems = await feedbackService_1.FeedbackService.getFeedbackItems(userId, filters, limit ? parseInt(limit) : 50);
        return res.json({ success: true, feedback: feedbackItems });
    }
    catch (error) {
        logger_1.default.error("Error fetching feedback items:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch feedback items",
        });
    }
});
// Get feedback items for the authenticated user
router.get("/my", async (req, res) => {
    try {
        // User ID will be attached by the authentication middleware in main-server.ts
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }
        const feedbackItems = await feedbackService_1.FeedbackService.getUserFeedback(userId);
        return res.json({ success: true, feedback: feedbackItems });
    }
    catch (error) {
        logger_1.default.error("Error fetching user feedback:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch user feedback",
        });
    }
});
// Get a specific feedback item by ID
router.get("/:id", async (req, res) => {
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
        const feedback = await feedbackService_1.FeedbackService.getFeedbackById(userId, id);
        if (!feedback) {
            return res.status(404).json({
                success: false,
                message: "Feedback not found",
            });
        }
        return res.json({ success: true, feedback });
    }
    catch (error) {
        if (error.message === "Unauthorized access to feedback") {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }
        logger_1.default.error("Error fetching feedback by ID:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch feedback",
        });
    }
});
// Update feedback status (admin only)
router.patch("/:id/status", async (req, res) => {
    try {
        const { id } = req.params;
        const { status, adminNotes } = req.body;
        if (!status) {
            return res.status(400).json({
                success: false,
                message: "Status is required",
            });
        }
        const validStatuses = ["open", "in_progress", "resolved", "closed"];
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
        const feedback = await feedbackService_1.FeedbackService.updateFeedbackStatus(userId, id, status, adminNotes);
        return res.json({ success: true, feedback });
    }
    catch (error) {
        if (error.message === "Only administrators can update feedback status") {
            return res.status(403).json({
                success: false,
                message: "Access denied. Admin privileges required.",
            });
        }
        logger_1.default.error("Error updating feedback status:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update feedback status",
        });
    }
});
// Add a comment to feedback
router.post("/:id/comments", async (req, res) => {
    try {
        const { id } = req.params;
        const commentData = req.body;
        // User ID will be attached by the authentication middleware in main-server.ts
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }
        if (!commentData.content) {
            return res.status(400).json({
                success: false,
                message: "Comment content is required",
            });
        }
        const comment = await feedbackService_1.FeedbackService.addFeedbackComment(userId, id, {
            user_id: userId || null,
            content: commentData.content,
            is_internal: commentData.is_internal || false,
        });
        return res.json({ success: true, comment });
    }
    catch (error) {
        if (error.message === "Unauthorized to comment on this feedback") {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }
        logger_1.default.error("Error adding feedback comment:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to add feedback comment",
        });
    }
});
// Get comments for a feedback item
router.get("/:id/comments", async (req, res) => {
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
        // Check if user should see internal comments (admins only)
        const isAdmin = await feedbackService_1.FeedbackService.isUserAdmin(userId);
        const includeInternal = isAdmin && req.query.include_internal === "true";
        const comments = await feedbackService_1.FeedbackService.getFeedbackComments(userId, id, includeInternal);
        return res.json({ success: true, comments });
    }
    catch (error) {
        if (error.message === "Unauthorized to view comments on this feedback") {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }
        logger_1.default.error("Error fetching feedback comments:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch feedback comments",
        });
    }
});
// Get feedback statistics (admin only)
router.get("/stats/summary", async (req, res) => {
    try {
        // User ID will be attached by the authentication middleware in main-server.ts
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "User not authenticated",
            });
        }
        const stats = await feedbackService_1.FeedbackService.getFeedbackStats(userId);
        return res.json({ success: true, stats });
    }
    catch (error) {
        if (error.message === "Only administrators can view feedback statistics") {
            return res.status(403).json({
                success: false,
                message: "Access denied. Admin privileges required.",
            });
        }
        logger_1.default.error("Error fetching feedback stats:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch feedback statistics",
        });
    }
});
exports.default = router;
