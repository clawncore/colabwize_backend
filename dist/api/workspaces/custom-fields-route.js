"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const workspaceTaskService_1 = require("../../services/workspaceTaskService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const role_1 = require("../../middleware/role");
const router = (0, express_1.Router)({ mergeParams: true });
/**
 * Get custom field definitions for a workspace
 */
router.get("/", (0, role_1.checkWorkspaceRole)("viewer"), async (req, res) => {
    try {
        const { workspaceId } = req.params;
        if (!workspaceId) {
            return res.status(400).json({ error: "Workspace ID is required" });
        }
        const fields = await workspaceTaskService_1.WorkspaceTaskService.getCustomFieldDefinitions(workspaceId);
        return res.json({ success: true, fields });
    }
    catch (error) {
        logger_1.default.error("Error fetching custom field definitions:", error);
        return res.status(500).json({ error: error.message });
    }
});
/**
 * Create a custom field definition
 */
router.post("/", (0, role_1.checkWorkspaceRole)("admin"), async (req, res) => {
    try {
        const { workspaceId } = req.params;
        const { name, type, options } = req.body;
        if (!workspaceId || !name || !type) {
            return res
                .status(400)
                .json({ error: "Workspace ID, name, and type are required" });
        }
        const field = await workspaceTaskService_1.WorkspaceTaskService.createCustomFieldDefinition(workspaceId, {
            name,
            type,
            options,
        });
        return res.status(201).json({ success: true, field });
    }
    catch (error) {
        logger_1.default.error("Error creating custom field definition:", error);
        return res.status(500).json({ error: error.message });
    }
});
/**
 * Delete a custom field definition
 */
router.delete("/definitions/:fieldId", (0, role_1.checkWorkspaceRole)("admin"), async (req, res) => {
    try {
        const { fieldId } = req.params;
        if (!fieldId) {
            return res.status(400).json({ error: "Field ID is required" });
        }
        await workspaceTaskService_1.WorkspaceTaskService.deleteCustomFieldDefinition(fieldId);
        return res.json({ success: true });
    }
    catch (error) {
        logger_1.default.error("Error deleting custom field definition:", error);
        return res.status(500).json({ error: error.message });
    }
});
exports.default = router;
