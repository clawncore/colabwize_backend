"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const notificationService_1 = require("../../../services/notificationService");
/**
 * Send a test notification to a user
 * POST /api/notifications/test/send
 */
async function POST(req, res) {
    try {
        // Get user ID from request (in a real implementation, this would come from authentication)
        const userId = req.body.userId || req.user?.id;
        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "User ID is required",
            });
        }
        // Get notification details from request body
        const { type, title, message, data } = req.body;
        // Create notification in database and send via WebSocket if user is connected
        const notification = await (0, notificationService_1.createNotification)(userId, type || "test_notification", title || "Test Notification", message || "This is a test notification", data || {});
        if (notification) {
            return res.status(200).json({
                success: true,
                message: "Test notification sent successfully",
                notification,
            });
        }
        else {
            return res.status(500).json({
                success: false,
                message: "Failed to create notification",
            });
        }
    }
    catch (error) {
        console.error("Send test notification failed", { error: error.message });
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
        });
    }
}
