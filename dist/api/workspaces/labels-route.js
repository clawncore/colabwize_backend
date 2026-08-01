"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const LabelService_1 = require("../../services/LabelService");
const role_1 = require("../../middleware/role");
const router = (0, express_1.Router)();
// GET /api/workspaces/:id/labels - Get labels for a workspace
router.get("/:id/labels", async (req, res) => {
    try {
        const { id } = req.params;
        const labels = await LabelService_1.LabelService.getWorkspaceLabels(id);
        res.json({ labels });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST /api/workspaces/:id/labels - Create a label
router.post("/:id/labels", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { id } = req.params;
        const { name, color } = req.body;
        if (!name)
            return res.status(400).json({ error: "Name is required" });
        const label = await LabelService_1.LabelService.createLabel(id, name, color);
        res.status(201).json({ label });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// PATCH /api/workspaces/labels/:labelId - Update a label
router.patch("/labels/:labelId", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { labelId } = req.params;
        const { name, color } = req.body;
        const label = await LabelService_1.LabelService.updateLabel(labelId, { name, color });
        res.json({ label });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// DELETE /api/workspaces/labels/:labelId - Delete a label
router.delete("/labels/:labelId", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { labelId } = req.params;
        await LabelService_1.LabelService.deleteLabel(labelId);
        res.json({ success: true });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// POST /api/workspaces/tasks/:taskId/labels/:labelId - Add label to task
router.post("/tasks/:taskId/labels/:labelId", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { taskId, labelId } = req.params;
        const task = await LabelService_1.LabelService.addLabelToTask(taskId, labelId);
        res.json({ task });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// DELETE /api/workspaces/tasks/:taskId/labels/:labelId - Remove label from task
router.delete("/tasks/:taskId/labels/:labelId", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { taskId, labelId } = req.params;
        const task = await LabelService_1.LabelService.removeLabelFromTask(taskId, labelId);
        res.json({ task });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
exports.default = router;
