import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

export class ProjectService {
    /**
     * Get recent projects for a specific user
     * Returns projects owned by the user
     */
    static async getRecentProjects(userId: string, limit: number = 5) {
        try {
            return await prisma.project.findMany({
                where: {
                    user_id: userId,
                },
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
        } catch (error) {
            logger.error("Error fetching recent projects:", error);
            throw error;
        }
    }
}
