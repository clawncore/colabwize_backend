import { NextFunction, Response } from "express";
import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

export type WorkspaceRole = "admin" | "editor" | "viewer";

const roles: WorkspaceRole[] = ["viewer", "editor", "admin"];

/**
 * Middleware to check if user has required role in workspace
 * @param requiredRole The minimum role required
 */
export const checkWorkspaceRole = (requiredRole: WorkspaceRole) => {
    return async (req: any, res: Response, next: NextFunction) => {
        try {
            const userId = req.user?.id;
            if (!userId) {
                return res.status(401).json({ error: "Unauthorized" });
            }

            // 1. Get workspaceId from specific places first
            let workspaceId = req.params.workspaceId || req.body.workspaceId || req.query.workspaceId;

            // 2. Identify specific entity IDs
            const taskId = req.params.taskId || req.body.taskId || req.query.id; // kanban uses ?id= for delete
            const attachmentId = req.params.attachmentId || (req.params.id && req.path.includes('attachments') ? req.params.id : undefined);
            const entryId = req.params.entryId || (req.params.id && (req.path.includes('time') || req.path.includes('/tasks/time')) ? req.params.id : undefined);
            const subtaskId = req.params.subtaskId || (req.path.includes('subtasks') && req.params.id ? req.params.id : undefined);
            const labelId = req.params.labelId;
            const viewId = req.params.viewId;

            // 3. If no workspaceId, resolve it from entities
            if (!workspaceId && taskId) {
                const task = await prisma.workspaceTask.findUnique({
                    where: { id: taskId },
                    select: { workspace_id: true }
                });
                if (task) workspaceId = task.workspace_id;
            } else if (!workspaceId && attachmentId) {
                const attachment = await prisma.taskAttachment.findUnique({
                    where: { id: attachmentId as string },
                    include: { task: { select: { workspace_id: true } } }
                });
                if (attachment) workspaceId = attachment.task.workspace_id;
            } else if (!workspaceId && entryId) {
                const entry = await prisma.taskTimeEntry.findUnique({
                    where: { id: entryId as string },
                    include: { task: { select: { workspace_id: true } } }
                });
                if (entry) workspaceId = entry.task.workspace_id;
            } else if (!workspaceId && subtaskId) {
                const subtask = await prisma.workspaceSubtask.findUnique({
                    where: { id: subtaskId as string },
                    include: { task: { select: { workspace_id: true } } }
                });
                if (subtask) workspaceId = subtask.task.workspace_id;
            } else if (!workspaceId && labelId) {
                const label = await prisma.workspaceLabel.findUnique({
                    where: { id: labelId as string },
                    select: { workspace_id: true }
                });
                if (label) workspaceId = label.workspace_id;
            } else if (!workspaceId && viewId) {
                const view = await prisma.workspaceView.findUnique({
                    where: { id: viewId as string },
                    select: { workspace_id: true }
                });
                if (view) workspaceId = view.workspace_id;
            }

            // 4. Fallback to generic 'id' parameter if still no workspaceId
            if (!workspaceId && req.params.id) {
                workspaceId = req.params.id;
            }

            if (!workspaceId) {
                return res.status(400).json({ error: "Workspace ID or Task ID is required for permission check" });
            }

            // 3. Check membership and role
            const workspace = await prisma.workspace.findFirst({
                where: {
                    id: workspaceId,
                    OR: [
                        { owner_id: userId },
                        { members: { some: { user_id: userId } } }
                    ]
                },
                include: {
                    members: {
                        where: { user_id: userId }
                    }
                }
            });

            if (!workspace) {
                return res.status(403).json({ error: "Access denied: Workspace not found or not a member" });
            }

            // Owner has all permissions
            if (workspace.owner_id === userId) {
                return next();
            }

            const member = workspace.members[0];
            if (!member) {
                return res.status(403).json({ error: "Access denied: Membership not found" });
            }

            // Check role hierarchy
            const hasPermission = roles.indexOf(member.role as WorkspaceRole) >= roles.indexOf(requiredRole);

            if (!hasPermission) {
                return res.status(403).json({
                    error: `Insufficient permissions. Required: ${requiredRole}, Current: ${member.role}`
                });
            }

            // Attach workspace role to request for future use
            req.workspaceRole = member.role;
            req.currentWorkspaceId = workspaceId;

            next();
        } catch (error) {
            logger.error("Error in checkWorkspaceRole middleware:", error);
            res.status(500).json({ error: "Internal server error during permission check" });
        }
    };
};
