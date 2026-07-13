"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubtaskService = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = __importDefault(require("../monitoring/logger"));
class SubtaskService {
    /**
     * Get all subtasks for a task
     */
    static async getSubtasks(taskId) {
        try {
            return await prisma_1.default.workspaceSubtask.findMany({
                where: { task_id: taskId },
                orderBy: { order: "asc" },
            });
        }
        catch (error) {
            logger_1.default.error("Error fetching subtasks:", error);
            throw error;
        }
    }
    /**
     * Create a subtask
     */
    static async createSubtask(taskId, title) {
        try {
            // Get the highest order to append at the end
            const lastSubtask = await prisma_1.default.workspaceSubtask.findFirst({
                where: { task_id: taskId },
                orderBy: { order: "desc" },
            });
            const nextOrder = lastSubtask ? lastSubtask.order + 1 : 0;
            return await prisma_1.default.workspaceSubtask.create({
                data: {
                    task_id: taskId,
                    title,
                    order: nextOrder,
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error creating subtask:", error);
            throw error;
        }
    }
    /**
     * Update a subtask (toggle done, rename, reorder)
     */
    static async updateSubtask(subtaskId, data) {
        try {
            return await prisma_1.default.workspaceSubtask.update({
                where: { id: subtaskId },
                data,
            });
        }
        catch (error) {
            logger_1.default.error("Error updating subtask:", error);
            throw error;
        }
    }
    /**
     * Delete a subtask
     */
    static async deleteSubtask(subtaskId) {
        try {
            await prisma_1.default.workspaceSubtask.delete({
                where: { id: subtaskId },
            });
            return { success: true };
        }
        catch (error) {
            logger_1.default.error("Error deleting subtask:", error);
            throw error;
        }
    }
}
exports.SubtaskService = SubtaskService;
