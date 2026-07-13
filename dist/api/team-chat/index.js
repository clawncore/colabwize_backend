"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const teamChatService_1 = __importDefault(require("../../services/teamChatService"));
const auth_1 = require("../../middleware/auth");
const router = (0, express_1.Router)();
// GET /api/team-chat - Fetch messages
router.get("/", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const workspaceId = req.query.workspaceId || undefined;
        const projectId = req.query.projectId || undefined;
        const parentId = req.query.parentId || undefined;
        const limit = parseInt(req.query.limit || "50");
        const offset = parseInt(req.query.offset || "0");
        const messages = await teamChatService_1.default.getMessages({
            workspaceId,
            projectId,
            parentId,
        }, limit, offset);
        res.status(200).json({ messages });
    }
    catch (error) {
        console.error("Error in Team Chat GET:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// POST /api/team-chat - Send a message
router.post("/", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { content, workspaceId, projectId, parentId } = req.body;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        if (!content) {
            return res.status(400).json({ error: "Content is required" });
        }
        const message = await teamChatService_1.default.sendMessage(userId, content, {
            workspaceId,
            projectId,
            parentId,
        });
        res.status(201).json({ message });
    }
    catch (error) {
        console.error("Error in Team Chat POST:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// DELETE /api/team-chat/clear - Clear all messages in a workspace or project
router.delete("/clear", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user?.id;
        const { workspaceId, projectId } = req.query;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        if (!workspaceId && !projectId) {
            return res
                .status(400)
                .json({ error: "Workspace or Project ID is required" });
        }
        const { count } = await teamChatService_1.default.clearChat({
            workspaceId: workspaceId,
            projectId: projectId,
        }, userId);
        res.status(200).json({ success: true, count });
    }
    catch (error) {
        console.error("Error in Team Chat CLEAR:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// DELETE /api/team-chat - Delete a message
router.delete("/", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const messageId = req.query.id;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        if (!messageId) {
            return res.status(400).json({ error: "Message ID is required" });
        }
        await teamChatService_1.default.deleteMessage(messageId, userId);
        res.status(200).json({ success: true });
    }
    catch (error) {
        console.error("Error in Team Chat DELETE:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
// PATCH /api/team-chat/:id - Edit a message
router.patch("/:id", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { id } = req.params;
        const { content } = req.body;
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        if (!content) {
            return res.status(400).json({ error: "Content is required" });
        }
        // Since TeamChatService.ts doesn't have a direct editMessage method yet, 
        // we'll use deleteMessage as a reference and implement the update directly or add it to service.
        // I will add updateMessage to TeamChatService.
        const message = await teamChatService_1.default.updateMessage(id, userId, content);
        res.status(200).json({ message });
    }
    catch (error) {
        console.error("Error in Team Chat PATCH:", error);
        res.status(500).json({ error: error.message || "Internal server error" });
    }
});
exports.default = router;
