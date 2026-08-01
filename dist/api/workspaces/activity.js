"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../../middleware/auth");
const workspaceActivityService_1 = require("../../services/workspaceActivityService");
const role_1 = require("../../middleware/role");
const router = express_1.default.Router();
// Get Activity Log for a Workspace
router.get("/:id/activity", auth_1.authenticateExpressRequest, (0, role_1.checkWorkspaceRole)("viewer"), async (req, res) => {
    try {
        const workspaceId = req.params.id;
        const userId = req.user.id;
        const limit = parseInt(req.query.limit) || 20;
        const offset = parseInt(req.query.offset) || 0;
        const { action, userId: filterUserId, startDate, endDate } = req.query;
        // Manual checks removed as middleware handles it
        const activities = await workspaceActivityService_1.WorkspaceActivityService.getActivities(workspaceId, limit, offset, {
            userId: filterUserId ? String(filterUserId) : undefined,
            action: action ? String(action) : undefined,
            startDate: startDate ? new Date(String(startDate)) : undefined,
            endDate: endDate ? new Date(String(endDate)) : undefined,
        });
        return res.json(activities);
    }
    catch (error) {
        console.error("Error fetching activities:", error);
        return res.status(500).json({ error: "Failed to fetch activities" });
    }
});
exports.default = router;
