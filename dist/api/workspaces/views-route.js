"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const workspaceViewService_1 = require("../../services/workspaceViewService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const role_1 = require("../../middleware/role");
const router = (0, express_1.Router)({ mergeParams: true });
// GET /api/workspaces/:workspaceId/views - Get all saved views
router.get("/", async (req, res) => {
    try {
        const { workspaceId } = req.params;
        const views = await workspaceViewService_1.WorkspaceViewService.getViews(workspaceId);
        res.json(views);
    }
    catch (error) {
        logger_1.default.error("Error in GET /views:", error);
        res.status(500).json({ error: "Failed to fetch views" });
    }
});
// POST /api/workspaces/:workspaceId/views - Create a saved view
router.post("/", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { workspaceId } = req.params;
        const { name, filters } = req.body;
        if (!name) {
            return res.status(400).json({ error: "View name is required" });
        }
        const view = await workspaceViewService_1.WorkspaceViewService.createView(workspaceId, name, filters);
        res.status(201).json(view);
    }
    catch (error) {
        logger_1.default.error("Error in POST /views:", error);
        res.status(500).json({ error: "Failed to create view" });
    }
});
// PATCH /api/workspaces/:workspaceId/views/:viewId - Update a saved view
router.patch("/:viewId", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { viewId } = req.params;
        const { name, filters } = req.body;
        const view = await workspaceViewService_1.WorkspaceViewService.updateView(viewId, name, filters);
        res.json(view);
    }
    catch (error) {
        logger_1.default.error("Error in PATCH /views/:viewId:", error);
        res.status(500).json({ error: "Failed to update view" });
    }
});
// DELETE /api/workspaces/:workspaceId/views/:viewId - Delete a saved view
router.delete("/:viewId", (0, role_1.checkWorkspaceRole)("editor"), async (req, res) => {
    try {
        const { viewId } = req.params;
        await workspaceViewService_1.WorkspaceViewService.deleteView(viewId);
        res.status(204).end();
    }
    catch (error) {
        logger_1.default.error("Error in DELETE /views/:viewId:", error);
        res.status(500).json({ error: "Failed to delete view" });
    }
});
exports.default = router;
