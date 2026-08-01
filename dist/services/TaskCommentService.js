"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskCommentService = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = __importDefault(require("../monitoring/logger"));
class TaskCommentService {
    /**
     * Get all comments for a task
     */
    static async getComments(taskId) {
        try {
            return await prisma_1.default.taskComment.findMany({
                where: { task_id: taskId },
                include: {
                    user: {
                        select: { id: true, full_name: true, email: true },
                    },
                },
                orderBy: { created_at: "asc" },
            });
        }
        catch (error) {
            logger_1.default.error("Error fetching task comments:", error);
            throw error;
        }
    }
    /**
     * Add a comment to a task
     */
    static async addComment(taskId, userId, content) {
        try {
            const task = await prisma_1.default.workspaceTask.findUnique({
                where: { id: taskId },
                select: {
                    id: true,
                    title: true,
                    workspace_id: true,
                    project_id: true,
                },
            });
            if (!task) {
                throw new Error("Task not found");
            }
            const comment = await prisma_1.default.taskComment.create({
                data: {
                    task_id: taskId,
                    user_id: userId,
                    content,
                },
                include: {
                    user: {
                        select: { id: true, full_name: true, email: true },
                    },
                },
            });
            // Handle @mentions
            const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
            const mentions = [];
            let match;
            while ((match = mentionRegex.exec(content)) !== null) {
                mentions.push({ name: match[1], id: match[2] });
            }
            if (mentions.length > 0) {
                const { createNotification } = require("./notificationService");
                const sender = comment.user;
                for (const mention of mentions) {
                    if (mention.id === userId)
                        continue;
                    await createNotification(mention.id, "mention", `Mention in task: ${task.title}`, `${sender.full_name || sender.email} mentioned you in a comment`, {
                        workspaceId: task.workspace_id,
                        projectId: task.project_id,
                        taskId: task.id,
                        commentId: comment.id,
                        senderId: userId,
                    });
                }
            }
            return comment;
        }
        catch (error) {
            logger_1.default.error("Error adding task comment:", error);
            throw error;
        }
    }
    /**
     * Delete a task comment
     */
    static async deleteComment(commentId, userId) {
        try {
            const comment = await prisma_1.default.taskComment.findUnique({
                where: { id: commentId },
            });
            if (!comment) {
                throw new Error("Comment not found");
            }
            if (comment.user_id !== userId) {
                throw new Error("Unauthorized to delete this comment");
            }
            await prisma_1.default.taskComment.delete({
                where: { id: commentId },
            });
            return { success: true };
        }
        catch (error) {
            logger_1.default.error("Error deleting task comment:", error);
            throw error;
        }
    }
}
exports.TaskCommentService = TaskCommentService;
exports.default = TaskCommentService;
