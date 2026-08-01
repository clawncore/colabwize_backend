"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const contactService_1 = require("../../services/contactService");
const router = (0, express_1.Router)();
// POST /api/contact - Handle contact form submission
router.post("/", async (req, res) => {
    try {
        const { name, email, subject, message } = req.body;
        // Validate required fields
        if (!name || !email || !subject || !message) {
            res.status(400).json({
                success: false,
                message: "All fields are required: name, email, subject, message",
            });
            return;
        }
        // Get IP address and user agent from request
        const ip_address = req.headers["x-forwarded-for"] ||
            req.socket.remoteAddress ||
            "unknown";
        const user_agent = req.headers["user-agent"] || "unknown";
        // Process the contact form submission
        const result = await contactService_1.ContactService.handleContactSubmission({
            name,
            email,
            subject,
            message,
            ip_address,
            user_agent,
        });
        res.status(200).json(result);
    }
    catch (error) {
        console.error("Error processing contact form:", error);
        res.status(500).json({
            success: false,
            message: error.message || "Failed to process contact form submission",
        });
    }
});
exports.default = router;
