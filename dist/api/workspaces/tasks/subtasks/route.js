"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const SubtaskService_1 = require("../../../../services/SubtaskService");
const auth_1 = require("../../../../middleware/auth");
const role_1 = require("../../../../middleware/role");
const router = (0, express_1.Router)();
// GET /api/workspaces/tasks/subtasks?taskId=... - Get subtasks for a task
router.get("/", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const taskId = req.query.taskId;
        if (!taskId)
            return res.status(400).json({ error: "Task ID is required" });
        const subtasks = await SubtaskService_1.SubtaskService.getSubtasks(taskId);
        res.json({ subtasks });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST /api/workspaces/tasks/subtasks - Create a subtask
router.post("/", auth_1.authenticateExpressRequest, (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { taskId, title } = req.body;
        if (!taskId || !title)
            return res.status(400).json({ error: "Task ID and title are required" });
        const subtask = await SubtaskService_1.SubtaskService.createSubtask(taskId, title);
        res.status(201).json({ subtask });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// PATCH /api/workspaces/tasks/subtasks/:subtaskId - Update a subtask
router.patch("/:subtaskId", auth_1.authenticateExpressRequest, (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { subtaskId } = req.params;
        const { title, is_done, order } = req.body;
        const subtask = await SubtaskService_1.SubtaskService.updateSubtask(subtaskId, {
            title,
            is_done,
            order,
        });
        res.json({ subtask });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// DELETE /api/workspaces/tasks/subtasks/:subtaskId - Delete a subtask
router.delete("/:subtaskId", auth_1.authenticateExpressRequest, (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { subtaskId } = req.params;
        await SubtaskService_1.SubtaskService.deleteSubtask(subtaskId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
