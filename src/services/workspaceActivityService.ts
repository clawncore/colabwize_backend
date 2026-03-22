import prisma from "../lib/prisma";
import logger from "../monitoring/logger";

export interface ActivityFilter {
    userId?: string;
    action?: string;
    startDate?: Date;
    endDate?: Date;
}

export class WorkspaceActivityService {
    /**
     * Log a workspace activity
     */
    static async logActivity(
        workspaceId: string,
        userId: string,
        action: string,
        details: any = null,
        ipAddress?: string
    ) {
        try {
            await prisma.workspaceActivity.create({
                data: {
                    workspace_id: workspaceId,
                    user_id: userId,
                    action,
                    details: details ? JSON.parse(JSON.stringify(details)) : undefined, // Ensure serializable
                    ip_address: ipAddress,
                },
            });
        } catch (error) {
            // Log error but don't block the main flow
            logger.error("Failed to log workspace activity:", error);
        }
    }

    /**
     * Get activities for a workspace
     */
    static async getActivities(
        workspaceId: string,
        limit: number = 20,
        offset: number = 0,
        filter?: ActivityFilter
    ) {
        try {
            const whereClause: any = {
                workspace_id: workspaceId,
            };

            if (filter?.userId) whereClause.user_id = filter.userId;
            if (filter?.action) whereClause.action = filter.action;
            if (filter?.startDate || filter?.endDate) {
                whereClause.created_at = {};
                if (filter.startDate) whereClause.created_at.gte = filter.startDate;
                if (filter.endDate) whereClause.created_at.lte = filter.endDate;
            }

            const [items, total] = await Promise.all([
                prisma.workspaceActivity.findMany({
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
                prisma.workspaceActivity.count({ where: whereClause }),
            ]);

            return { items, total };
        } catch (error) {
            logger.error("Error fetching workspace activities:", error);
            throw error;
        }
    }
}
