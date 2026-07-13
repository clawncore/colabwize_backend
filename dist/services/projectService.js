"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProjectService = void 0;
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
class ProjectService {
    /**
     * Get recent projects for a specific user
     * Returns projects owned by the user
     */
    static async getRecentProjects(userId, limit = 5, workspaceId) {
        try {
            const whereClause = workspaceId
                ? { workspace_id: workspaceId }
                : { user_id: userId };
            return await prisma_1.prisma.project.findMany({
                where: whereClause,
                orderBy: { updated_at: "desc" },
                take: limit,
                include: {
                    user: {
                        select: {
                            id: true,
                            full_name: true,
                            email: true,
                        },
                    },
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error fetching recent projects:", error);
            throw error;
        }
    }
}
exports.ProjectService = ProjectService;
