"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const auth_helpers_1 = require("../../lib/auth-helpers");
const router = express_1.default.Router();
/**
 * GET /api/citations/:projectId
 * Get all citations for a project
 */
router.get("/:projectId", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId } = req.params;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                error: "Project ID is required",
            });
        }
        // Verify access to the project
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: "Access denied or project not found",
            });
        }
        const citations = await prisma_1.prisma.citation.findMany({
            where: {
                project_id: projectId,
            },
            orderBy: {
                created_at: 'desc'
            }
        });
        // Maintain legacy response mapping expectations if any client strictly relies on it
        // but returning raw from DB is normally sufficient if it matches StoredCitation
        return res.status(200).json({
            success: true,
            data: citations,
        });
    }
    catch (error) {
        logger_1.default.error("Error fetching citations", {
            error: error.message,
            stack: error.stack,
            projectId: req.params.projectId
        });
        return res.status(500).json({
            success: false,
            error: error.message || "Failed to fetch citations",
        });
    }
});
exports.default = router;
