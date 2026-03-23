import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

export class WorkspaceAnalyticsService {
  /**
   * Aggregates analytics for a specific workspace
   */
  static async getWorkspaceAnalytics(workspaceId: string) {
    try {
      // 1. Get task status distribution
      const statusCounts = await prisma.workspaceTask.groupBy({
        by: ["status"],
        where: { workspace_id: workspaceId },
        _count: { _all: true },
      });

      // 2. Get task priority distribution
      const priorityCounts = await prisma.workspaceTask.groupBy({
        by: ["priority"],
        where: { workspace_id: workspaceId },
        _count: { _all: true },
      });

      // 3. Get member task completion stats
      // First, get all members in the workspace so we can initialize them to 0
      const allMembers = await prisma.workspaceMember.findMany({
        where: { workspace_id: workspaceId },
        include: {
          user: {
            select: { id: true, full_name: true, email: true },
          },
        },
      });

      // 3. Get member task completion stats & workload balance
      const memberStatsMap = new Map<
        string,
        { assigned: number; completed: number }
      >();

      // Initialize all members with 0
      allMembers.forEach((member: any) => {
        const name = member.user.full_name || member.user.email;
        memberStatsMap.set(name, { assigned: 0, completed: 0 });
      });

      // Get all task assignments for this workspace
      const allAssignments = await prisma.taskAssignee.findMany({
        where: {
          task: { workspace_id: workspaceId },
        },
        include: {
          task: { select: { status: true } },
          user: { select: { id: true, full_name: true, email: true } },
        },
      });

      allAssignments.forEach((assignment: any) => {
        const name = assignment.user.full_name || assignment.user.email;
        const stats = memberStatsMap.get(name) || { assigned: 0, completed: 0 };

        stats.assigned++;
        if (assignment.task.status === "done") {
          stats.completed++;
        }
        memberStatsMap.set(name, stats);
      });

      const memberActivity = Array.from(memberStatsMap.entries()).map(
        ([name, stats]) => ({
          name,
          ...stats,
        }),
      );

      // 4. Trend: Completion over last 14 days
      const now = new Date();
      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);
      fourteenDaysAgo.setHours(0, 0, 0, 0);

      const completedTasksHistory = await prisma.workspaceTask.findMany({
        where: {
          workspace_id: workspaceId,
          status: "done",
          updated_at: { gte: fourteenDaysAgo },
        },
        select: { updated_at: true, created_at: true },
      });

      const trendMap = new Map<string, number>();
      for (let i = 0; i < 14; i++) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        trendMap.set(d.toISOString().split("T")[0], 0);
      }

      completedTasksHistory.forEach((task: { updated_at: Date }) => {
        const dateStr = task.updated_at.toISOString().split("T")[0];
        if (trendMap.has(dateStr)) {
          trendMap.set(dateStr, (trendMap.get(dateStr) || 0) + 1);
        }
      });

      const completionTrend = Array.from(trendMap.entries())
        .map(([date, count]: [string, number]) => ({ date, count }))
        .sort((a, b) => a.date.localeCompare(b.date));

      // 5. Health Metrics: Overdue & Upcoming
      const nextSevenDays = new Date();
      nextSevenDays.setDate(nextSevenDays.getDate() + 7);

      const overdueCount = await prisma.workspaceTask.count({
        where: {
          workspace_id: workspaceId,
          status: { not: "done" },
          due_date: { lt: now },
        },
      });

      const upcomingCount = await prisma.workspaceTask.count({
        where: {
          workspace_id: workspaceId,
          status: { not: "done" },
          due_date: {
            gte: now,
            lte: nextSevenDays,
          },
        },
      });

      // 6. Efficiency: Avg Completion Time
      let totalCompletionTimeDays = 0;
      completedTasksHistory.forEach(
        (task: { updated_at: Date; created_at: Date }) => {
          const durationMs =
            task.updated_at.getTime() - task.created_at.getTime();
          totalCompletionTimeDays += durationMs / (1000 * 60 * 60 * 24);
        },
      );

      const avgCompletionDays =
        completedTasksHistory.length > 0
          ? parseFloat(
              (totalCompletionTimeDays / completedTasksHistory.length).toFixed(
                1,
              ),
            )
          : 0;

      // 7. High-level stats
      const totalTasks = await prisma.workspaceTask.count({
        where: { workspace_id: workspaceId },
      });

      const totalMembers = await prisma.workspaceMember.count({
        where: { workspace_id: workspaceId },
      });

      const doneStatusCount = statusCounts.find(
        (s: { status: string; _count: { _all: number } }) =>
          s.status === "done",
      );
      const doneTasks = doneStatusCount?._count._all || 0;
      const completionRate =
        totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

      return {
        totalTasks,
        doneTasks,
        totalMembers,
        completionRate,
        health: {
          overdue: overdueCount,
          upcoming: upcomingCount,
        },
        efficiency: {
          avgCompletionDays,
        },
        statusDistribution: statusCounts.map(
          (s: { status: string; _count: { _all: number } }) => ({
            name: s.status,
            value: s._count._all,
          }),
        ),
        priorityDistribution: priorityCounts.map(
          (p: { priority: string; _count: { _all: number } }) => ({
            status: p.priority,
            count: p._count._all,
          }),
        ),
        memberActivity,
        completionTrend,
      };
    } catch (error) {
      logger.error("Error fetching workspace analytics:", error);
      throw error;
    }
  }

  /**
   * Get analytics for a specific project
   */
  static async getProjectAnalytics(projectId: string) {
    try {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          tasks: {
            include: {
              assignees: { include: { user: true } },
            },
          },
        },
      });

      if (!project) {
        throw new Error(`Project ${projectId} not found`);
      }

      const tasks = project.tasks;
      const total = tasks.length;
      const completed = tasks.filter((t: any) => t.status === "done").length;
      const inProgress = tasks.filter(
        (t: any) => t.status === "in-progress",
      ).length;
      const todo = tasks.filter((t: any) => t.status === "todo").length;

      // Recent activity (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const recentTasks = tasks.filter(
        (t: any) => new Date(t.updated_at) >= sevenDaysAgo,
      );

      return {
        projectId,
        projectTitle: project.title,
        projectStatus: project.status,
        taskStats: {
          total,
          completed,
          inProgress,
          todo,
          completionRate: total > 0 ? Math.round((completed / total) * 100) : 0,
        },
        recentActivity: {
          tasksUpdated: recentTasks.length,
          tasksCompleted: recentTasks.filter((t: any) => t.status === "done")
            .length,
        },
      };
    } catch (error) {
      logger.error(`Error fetching project analytics for ${projectId}:`, error);
      throw error;
    }
  }

  /**
   * Get workspace analytics enhanced with project metrics
   */
  static async getWorkspaceAnalyticsWithProjects(workspaceId: string) {
    try {
      // Get base workspace analytics
      const baseAnalytics = await this.getWorkspaceAnalytics(workspaceId);

      // Get projects in this workspace
      const projects = await prisma.project.findMany({
        where: { workspace_id: workspaceId },
        include: {
          tasks: {
            select: { status: true },
          },
        },
      });

      // Calculate project metrics
      const projectMetrics = projects.map((p: any) => {
        const totalTasks = p.tasks.length;
        const completedTasks = p.tasks.filter(
          (t: any) => t.status === "done",
        ).length;

        return {
          id: p.id,
          title: p.title,
          status: p.status,
          totalTasks,
          completedTasks,
          progress:
            totalTasks > 0
              ? Math.round((completedTasks / totalTasks) * 100)
              : 0,
        };
      });

      return {
        ...baseAnalytics,
        projectMetrics,
      };
    } catch (error) {
      logger.error("Error fetching workspace analytics with projects:", error);
      throw error;
    }
  }
}
