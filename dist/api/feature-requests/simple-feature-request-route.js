"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleSimpleFeatureRequest = void 0;
const featureRequestService_1 = require("../../services/featureRequestService");
const handleSimpleFeatureRequest = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }
    try {
        const { title: featureTitle, description: featureDescription, category = "other", priority = "nice-to-have", email, } = req.body;
        // Validate required fields
        if (!featureTitle || !featureDescription) {
            return res.status(400).json({
                error: "Missing required fields: title and description are required",
            });
        }
        // Validate category and priority values
        const validCategories = [
            "writing",
            "ai",
            "citations",
            "collaboration",
            "organization",
            "integration",
            "other",
        ];
        const validPriorities = ["nice-to-have", "important", "critical"];
        if (!validCategories.includes(category)) {
            return res.status(400).json({ error: "Invalid category" });
        }
        if (!validPriorities.includes(priority)) {
            return res.status(400).json({ error: "Invalid priority" });
        }
        // Validate email if provided
        if (email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({ error: "Invalid email format" });
            }
        }
        // Get client IP and user agent
        const ip_address = req.ip ||
            req.headers["x-forwarded-for"] ||
            req.headers["x-real-ip"] ||
            req.connection.remoteAddress ||
            req.socket.remoteAddress ||
            req.connection.remoteAddress;
        const user_agent = req.headers["user-agent"];
        // Create the feature request in the database
        let finalDescription = featureDescription;
        if (email)
            finalDescription += `\n\nContact Email: ${email}`;
        const featureRequest = await featureRequestService_1.FeatureRequestService.createFeatureRequest({
            user_id: null,
            title: featureTitle,
            description: finalDescription,
            category,
            priority,
        });
        // Notification is handled inside FeatureRequestService.createFeatureRequest via notifyFeatureTeam
        return res.status(200).json({
            message: "Feature request submitted successfully",
            featureRequestId: featureRequest.id,
        });
    }
    catch (error) {
        console.error("Error handling simple feature request:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
};
exports.handleSimpleFeatureRequest = handleSimpleFeatureRequest;
exports.default = exports.handleSimpleFeatureRequest;
