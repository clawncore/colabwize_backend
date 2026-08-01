"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LabelService = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = __importDefault(require("../monitoring/logger"));
class LabelService {
    /**
     * Get all labels for a workspace
     */
    static async getWorkspaceLabels(workspaceId) {
        try {
            return await prisma_1.default.workspaceLabel.findMany({
                where: { workspace_id: workspaceId },
                orderBy: { name: "asc" },
            });
        }
        catch (error) {
            logger_1.default.error("Error fetching workspace labels:", error);
            throw error;
        }
    }
    /**
     * Create a label for a workspace
     */
    static async createLabel(workspaceId, name, color) {
        try {
            return await prisma_1.default.workspaceLabel.create({
                data: {
                    workspace_id: workspaceId,
                    name,
                    color,
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error creating workspace label:", error);
            throw error;
        }
    }
    /**
     * Update a label
     */
    static async updateLabel(labelId, data) {
        try {
            return await prisma_1.default.workspaceLabel.update({
                where: { id: labelId },
                data,
            });
        }
        catch (error) {
            logger_1.default.error("Error updating workspace label:", error);
            throw error;
        }
    }
    /**
     * Delete a label
     */
    static async deleteLabel(labelId) {
        try {
            await prisma_1.default.workspaceLabel.delete({
                where: { id: labelId },
            });
            return { success: true };
        }
        catch (error) {
            logger_1.default.error("Error deleting workspace label:", error);
            throw error;
        }
    }
    /**
     * Add a label to a task
     */
    static async addLabelToTask(taskId, labelId) {
        try {
            return await prisma_1.default.workspaceTask.update({
                where: { id: taskId },
                data: {
                    labels: {
                        connect: { id: labelId },
                    },
                },
                include: {
                    labels: true,
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error adding label to task:", error);
            throw error;
        }
    }
    /**
     * Remove a label from a task
     */
    static async removeLabelFromTask(taskId, labelId) {
        try {
            return await prisma_1.default.workspaceTask.update({
                where: { id: taskId },
                data: {
                    labels: {
                        disconnect: { id: labelId },
                    },
                },
                include: {
                    labels: true,
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error removing label from task:", error);
            throw error;
        }
    }
}
exports.LabelService = LabelService;
