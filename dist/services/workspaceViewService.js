"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WorkspaceViewService = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = __importDefault(require("../monitoring/logger"));
class WorkspaceViewService {
    /**
     * Get all saved views for a workspace
     */
    static async getViews(workspaceId) {
        try {
            return await prisma_1.default.workspaceView.findMany({
                where: { workspace_id: workspaceId },
                orderBy: { created_at: "asc" },
            });
        }
        catch (error) {
            logger_1.default.error("Error fetching workspace views:", error);
            throw error;
        }
    }
    /**
     * Create a new saved view
     */
    static async createView(workspaceId, name, filters) {
        try {
            return await prisma_1.default.workspaceView.create({
                data: {
                    workspace_id: workspaceId,
                    name,
                    filters: filters,
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error creating workspace view:", error);
            throw error;
        }
    }
    /**
     * Delete a saved view
     */
    static async deleteView(viewId) {
        try {
            return await prisma_1.default.workspaceView.delete({
                where: { id: viewId },
            });
        }
        catch (error) {
            logger_1.default.error("Error deleting workspace view:", error);
            throw error;
        }
    }
    /**
     * Update a saved view
     */
    static async updateView(viewId, name, filters) {
        try {
            const data = {};
            if (name)
                data.name = name;
            if (filters)
                data.filters = filters;
            return await prisma_1.default.workspaceView.update({
                where: { id: viewId },
                data,
            });
        }
        catch (error) {
            logger_1.default.error("Error updating workspace view:", error);
            throw error;
        }
    }
}
exports.WorkspaceViewService = WorkspaceViewService;
