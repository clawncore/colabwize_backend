"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const teamChatService_1 = require("../../services/teamChatService");
const router = (0, express_1.Router)();
router.get("/", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: "Authentication required" });
        const { workspaceId, projectId, parentId, limit, offset } = req.query;
        const messages = await teamChatService_1.CommentService.getMessages({ workspaceId, projectId, parentId }, limit ? parseInt(limit) : 50, offset ? parseInt(offset) : 0);
        return res.json({ success: true, messages });
    }
    catch (error) {
        console.error("Error fetching messages:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
router.get("/thread/:parentId", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: "Authentication required" });
        const { parentId } = req.params;
        const messages = await teamChatService_1.CommentService.getThreadMessages(parentId);
        return res.json({ success: true, messages });
    }
    catch (error) {
        console.error("Error fetching thread:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
router.post("/", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: "Authentication required" });
        const { content, workspaceId, projectId, parentId } = req.body;
        if (!content) {
            return res.status(400).json({ error: "Content is required" });
        }
        const message = await teamChatService_1.CommentService.sendMessage(userId, content, {
            workspaceId,
            projectId,
            parentId,
        });
        return res.status(201).json({ success: true, message });
    }
    catch (error) {
        console.error("Error sending message:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
router.patch("/:id", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: "Authentication required" });
        const { id } = req.params;
        const { content } = req.body;
        if (!content) {
            return res.status(400).json({ error: "Content is required" });
        }
        const updated = await teamChatService_1.CommentService.updateMessage(id, userId, content);
        return res.json({ success: true, message: updated });
    }
    catch (error) {
        console.error("Error updating message:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
router.patch("/:id/status", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: "Authentication required" });
        const { id } = req.params;
        const { status } = req.body;
        if (!status || !["active", "resolved"].includes(status)) {
            return res.status(400).json({ error: "Status must be 'active' or 'resolved'" });
        }
        const updated = await teamChatService_1.CommentService.updateMessageStatus(id, userId, status);
        return res.json({ success: true, message: updated });
    }
    catch (error) {
        console.error("Error updating message status:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
router.delete("/:id", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId)
            return res.status(401).json({ error: "Authentication required" });
        const { id } = req.params;
        const result = await teamChatService_1.CommentService.deleteMessage(id, userId);
        return res.json(result);
    }
    catch (error) {
        console.error("Error deleting message:", error);
        return res.status(500).json({ error: error.message || "Internal server error" });
    }
});
exports.default = router;
