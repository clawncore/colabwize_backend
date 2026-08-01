"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const supportTicketService_1 = require("../../services/supportTicketService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const auth_1 = require("../../middleware/auth");
const recaptcha_1 = require("../../utils/recaptcha");
const router = (0, express_1.Router)();
// Create a new support ticket
router.post("/", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        // User ID will be attached by the authentication middleware in main-server.ts
        const userId = req.user?.id;
        const { token, ...ticketData } = req.body;
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
        if (!ticketData.subject || !ticketData.message) {
            return res.status(400).json({
                success: false,
                message: "Subject and message are required",
            });
        }
        const validSubjects = ["technical", "billing", "feature", "bug", "other"];
        if (!validSubjects.includes(ticketData.subject)) {
            return res.status(400).json({
                success: false,
                message: "Invalid subject",
            });
        }
        const validPriorities = ["low", "normal", "high", "urgent"];
        if (ticketData.priority && !validPriorities.includes(ticketData.priority)) {
            return res.status(400).json({
                success: false,
                message: "Invalid priority level",
            });
        }
        const ticket = await supportTicketService_1.SupportTicketService.createSupportTicket({
            user_id: userId || null,
            subject: ticketData.subject,
            message: ticketData.message,
            priority: ticketData.priority || "normal",
            attachment_url: ticketData.attachmentUrl || null,
            browser_info: ticketData.browserInfo || null,
            os_info: ticketData.osInfo || null,
            screen_size: ticketData.screenSize || null,
            user_plan: ticketData.userPlan || null,
        });
        return res.json({ success: true, ticket });
    }
    catch (error) {
        logger_1.default.error("Error creating support ticket:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create support ticket",
        });
    }
});
// Get tickets for the authenticated user
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
        const tickets = await supportTicketService_1.SupportTicketService.getUserTickets(userId);
        return res.json({ success: true, tickets });
    }
    catch (error) {
        logger_1.default.error("Error fetching user tickets:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch user tickets",
        });
    }
});
// Get a specific ticket by ID
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
        const ticket = await supportTicketService_1.SupportTicketService.getTicketById(userId, id);
        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: "Ticket not found",
            });
        }
        return res.json({ success: true, ticket });
    }
    catch (error) {
        if (error.message === "Unauthorized access to ticket") {
            return res.status(403).json({
                success: false,
                message: "Access denied",
            });
        }
        logger_1.default.error("Error fetching ticket by ID:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch ticket",
        });
    }
});
// Update ticket status (admin only)
router.patch("/:id/status", auth_1.authenticateExpressRequest, async (req, res) => {
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
        const ticket = await supportTicketService_1.SupportTicketService.updateTicketStatus(userId, id, status, adminNotes);
        return res.json({ success: true, ticket });
    }
    catch (error) {
        if (error.message === "Only administrators can update ticket status") {
            return res.status(403).json({
                success: false,
                message: "Access denied. Admin privileges required.",
            });
        }
        logger_1.default.error("Error updating ticket status:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update ticket status",
        });
    }
});
exports.default = router;
