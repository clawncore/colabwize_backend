"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const taskDependencyService_1 = __importDefault(require("../../../services/taskDependencyService"));
const logger_1 = __importDefault(require("../../../monitoring/logger"));
const router = (0, express_1.Router)({ mergeParams: true });
// POST /api/workspaces/:id/tasks/:taskId/dependencies - Add a dependency
router.post("/", async (req, res) => {
    try {
        const { taskId } = req.params;
        const { dependsOnId } = req.body;
        if (!dependsOnId) {
            return res.status(400).json({ error: "dependsOnId is required" });
        }
        const dependency = await taskDependencyService_1.default.addDependency(taskId, dependsOnId);
        res.json(dependency);
    }
    catch (error) {
        logger_1.default.error("Error adding task dependency via API", error);
        res
            .status(400)
            .json({ error: error.message || "Failed to add dependency" });
    }
});
// DELETE /api/workspaces/:id/tasks/:taskId/dependencies/:dependsOnId - Remove a dependency
router.delete("/:dependsOnId", async (req, res) => {
    try {
        const { taskId, dependsOnId } = req.params;
        await taskDependencyService_1.default.removeDependency(taskId, dependsOnId);
        res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Error removing task dependency via API", error);
        res.status(500).json({ error: "Failed to remove dependency" });
    }
});
// GET /api/workspaces/:id/tasks/:taskId/dependencies - Get dependencies for a task
router.get("/", async (req, res) => {
    try {
        const { taskId } = req.params;
        const dependencies = await taskDependencyService_1.default.getDependencies(taskId);
        res.json(dependencies);
    }
    catch (error) {
        logger_1.default.error("Error fetching task dependencies via API", error);
        res.status(500).json({ error: "Failed to fetch dependencies" });
    }
});
exports.default = router;
