"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceActivityService = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = __importDefault(require("../monitoring/logger"));
class WorkspaceActivityService {
    /**
     * Log a workspace activity
     */
    static async logActivity(workspaceId, userId, action, details = null, ipAddress) {
        try {
            await prisma_1.default.workspaceActivity.create({
                data: {
                    workspace_id: workspaceId,
                    user_id: userId,
                    action,
                    details: details ? JSON.parse(JSON.stringify(details)) : undefined, // Ensure serializable
                    ip_address: ipAddress,
                },
            });
        }
        catch (error) {
            // Log error but don't block the main flow
            logger_1.default.error("Failed to log workspace activity:", error);
        }
    }
    /**
     * Get activities for a workspace
     */
    static async getActivities(workspaceId, limit = 20, offset = 0, filter) {
        try {
            const whereClause = {
                workspace_id: workspaceId,
            };
            if (filter?.userId)
                whereClause.user_id = filter.userId;
            if (filter?.action)
                whereClause.action = filter.action;
            if (filter?.startDate || filter?.endDate) {
                whereClause.created_at = {};
                if (filter.startDate)
                    whereClause.created_at.gte = filter.startDate;
                if (filter.endDate)
                    whereClause.created_at.lte = filter.endDate;
            }
            const [items, total] = await Promise.all([
                prisma_1.default.workspaceActivity.findMany({
                    where: whereClause,
                    include: {
                        user: {
                            select: {
                                id: true,
                                full_name: true,
                                email: true,
                                avatar_url: true,
                            },
                        },
                    },
                    orderBy: { created_at: "desc" },
                    take: limit,
                    skip: offset,
                }),
                prisma_1.default.workspaceActivity.count({ where: whereClause }),
            ]);
            return { items, total };
        }
        catch (error) {
            logger_1.default.error("Error fetching workspace activities:", error);
            throw error;
        }
    }
}
exports.WorkspaceActivityService = WorkspaceActivityService;
