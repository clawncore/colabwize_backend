import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

export class ProjectService {
  /**
   * Get recent projects for a specific user
   * Returns projects owned by the user
   */
  static async getRecentProjects(
    userId: string,
    limit: number = 5,
    workspaceId?: string,
  ) {
    try {
      const whereClause: any = workspaceId
        ? { workspace_id: workspaceId }
        : { user_id: userId };

      return await prisma.project.findMany({
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
    } catch (error) {
      logger.error("Error fetching recent projects:", error);
      throw error;
    }
  }
}
