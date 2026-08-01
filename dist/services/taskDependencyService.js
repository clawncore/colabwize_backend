"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
class TaskDependencyService {
    /**
     * Add a dependency (taskTaskId depends on dependsOnTaskId)
     */
    static async addDependency(taskId, dependsOnId) {
        if (taskId === dependsOnId) {
            throw new Error("A task cannot depend on itself");
        }
        try {
            // Check for circular dependency (Basic 1-level check for now)
            // For a more robust solution, a graph traversal would be needed.
            const existingReverse = await prisma_1.prisma.taskDependency.findUnique({
                where: {
                    task_id_depends_on_id: {
                        task_id: dependsOnId,
                        depends_on_id: taskId,
                    },
                },
            });
            if (existingReverse) {
                throw new Error("Circular dependency detected");
            }
            const dependency = await prisma_1.prisma.taskDependency.create({
                data: {
                    task_id: taskId,
                    depends_on_id: dependsOnId,
                },
                include: {
                    depends_on: true,
                },
            });
            return dependency;
        }
        catch (error) {
            logger_1.default.error("Error adding task dependency:", error);
            throw error;
        }
    }
    /**
     * Remove a dependency
     */
    static async removeDependency(taskId, dependsOnId) {
        try {
            await prisma_1.prisma.taskDependency.delete({
                where: {
                    task_id_depends_on_id: {
                        task_id: taskId,
                        depends_on_id: dependsOnId,
                    },
                },
            });
            return { success: true };
        }
        catch (error) {
            logger_1.default.error("Error removing task dependency:", error);
            throw error;
        }
    }
    /**
     * List dependencies for a task
     */
    static async getDependencies(taskId) {
        try {
            return await prisma_1.prisma.taskDependency.findMany({
                where: { task_id: taskId },
                include: {
                    depends_on: {
                        select: {
                            id: true,
                            title: true,
                            status: true,
                        },
                    },
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error fetching task dependencies:", error);
            throw error;
        }
    }
    /**
     * List tasks that are blocked by this task
     */
    static async getBlockedTasks(taskId) {
        try {
            return await prisma_1.prisma.taskDependency.findMany({
                where: { depends_on_id: taskId },
                include: {
                    task: {
                        select: {
                            id: true,
                            title: true,
                            status: true,
                        },
                    },
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error fetching blocked tasks:", error);
            throw error;
        }
    }
}
exports.default = TaskDependencyService;
