"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TeamChatService = void 0;
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = __importDefault(require("../monitoring/logger"));
const notificationService_1 = require("./notificationService");
const notificationServer_1 = require("../lib/notificationServer");
class TeamChatService {
    /**
     * Fetch messages with basic threading support
     */
    static async getMessages(filter, limit = 50, offset = 0) {
        try {
            const where = {
                workspace_id: filter.workspaceId,
                project_id: filter.projectId,
            };
            // Only filter by parent_id if explicitly requested
            if (filter.parentId !== undefined) {
                where.parent_id = filter.parentId || null;
            }
            const messages = await prisma_1.default.teamChatMessage.findMany({
                where,
                include: {
                    user: {
                        select: {
                            id: true,
                            full_name: true,
                            email: true,
                            avatar_url: true,
                        },
                    },
                    parent: {
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
                    },
                    _count: {
                        select: {
                            replies: true,
                            read_by: true
                        },
                    },
                },
                orderBy: {
                    created_at: "asc",
                },
                take: limit,
                skip: offset,
            });
            return messages;
        }
        catch (error) {
            logger_1.default.error("Error fetching chat messages:", error);
            throw error;
        }
    }
    /**
     * Send a new message
     */
    static async sendMessage(userId, content, filter) {
        try {
            const message = await prisma_1.default.teamChatMessage.create({
                data: {
                    user_id: userId,
                    content,
                    workspace_id: filter.workspaceId,
                    project_id: filter.projectId,
                    parent_id: filter.parentId,
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            full_name: true,
                            email: true,
                            avatar_url: true,
                        },
                    },
                    parent: {
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
                    },
                },
            });
            logger_1.default.info(`[CHAT] Message sent successfully: ${message.id}`, {
                userId,
                workspaceId: filter.workspaceId,
                projectId: filter.projectId,
                contentLength: content.length,
            });
            // 1. Handle @mentions (existing logic)
            const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
            const mentions = [];
            let match;
            while ((match = mentionRegex.exec(content)) !== null) {
                mentions.push({ name: match[1], id: match[2] });
            }
            const sender = message.user;
            const contextName = filter.workspaceId
                ? "workspace chat"
                : "project chat";
            if (mentions.length > 0) {
                // Notify each mentioned user
                for (const mention of mentions) {
                    if (mention.id === userId)
                        continue; // Don't notify self
                    await (0, notificationService_1.createNotification)(mention.id, "mention", `New mention in ${contextName}`, `${sender.full_name || sender.email} mentioned you: "${content.substring(0, 50)}${content.length > 50 ? "..." : ""}"`, {
                        workspaceId: filter.workspaceId,
                        projectId: filter.projectId,
                        messageId: message.id,
                        senderId: userId,
                        encryptedContent: content,
                    });
                }
            }
            // 2. Notify other members of the workspace/project who were NOT mentioned
            // We need to fetch members first
            try {
                let memberIds = [];
                if (filter.workspaceId) {
                    const workspaceMembers = await prisma_1.default.workspaceMember.findMany({
                        where: { workspace_id: filter.workspaceId },
                        select: { user_id: true },
                    });
                    memberIds = workspaceMembers.map((m) => m.user_id);
                }
                else if (filter.projectId) {
                    const projectCollaborators = await prisma_1.default.projectCollaborator.findMany({
                        where: { project_id: filter.projectId },
                        select: { user_id: true },
                    });
                    memberIds = projectCollaborators.map((c) => c.user_id);
                    // Also include project owner
                    const project = await prisma_1.default.project.findUnique({
                        where: { id: filter.projectId },
                        select: { user_id: true },
                    });
                    if (project)
                        memberIds.push(project.user_id);
                }
                const mentionedIds = new Set(mentions.map((m) => m.id));
                const membersToNotify = memberIds.filter((id) => id !== userId && !mentionedIds.has(id));
                for (const targetUserId of membersToNotify) {
                    await (0, notificationService_1.createNotification)(targetUserId, "comment", // Using comment type for general messages
                    `New message in ${contextName}`, `${sender.full_name || sender.email}: "${content.substring(0, 50)}${content.length > 50 ? "..." : ""}"`, {
                        workspaceId: filter.workspaceId,
                        projectId: filter.projectId,
                        messageId: message.id,
                        senderId: userId,
                        isGeneralChat: true,
                        encryptedContent: content,
                    });
                }
            }
            catch (notifyError) {
                logger_1.default.error("Error sending general chat notifications:", notifyError);
                // Don't throw, we don't want to break message sending if notifications fail
            }
            // Broadcast to custom WebSocket for real-time chat sync
            try {
                const { getNotificationServer } = await import("../lib/notificationServer.js");
                const channelName = `team-chat-${filter.workspaceId || filter.projectId}`;
                getNotificationServer().broadcastToChannel(channelName, {
                    type: "NEW_MESSAGE",
                    message: message,
                });
                logger_1.default.info(`Broadcasted NEW_MESSAGE to channel ${channelName}`);
            }
            catch (wsError) {
                logger_1.default.error("Error broadcasting chat message via WebSocket:", wsError);
            }
            return message;
        }
        catch (error) {
            logger_1.default.error("Error sending chat message:", error);
            throw error;
        }
    }
    /**
     * Update a message content
     */
    static async updateMessage(messageId, userId, content) {
        try {
            // Check ownership
            const existingMessage = await prisma_1.default.teamChatMessage.findUnique({
                where: { id: messageId },
            });
            if (!existingMessage) {
                throw new Error("Message not found");
            }
            if (existingMessage.user_id !== userId) {
                throw new Error("Unauthorized");
            }
            const message = await prisma_1.default.teamChatMessage.update({
                where: { id: messageId },
                data: {
                    content,
                    updated_at: new Date(),
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            full_name: true,
                            email: true,
                            avatar_url: true,
                        },
                    },
                    parent: {
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
                    },
                },
            });
            // Broadcast to channel
            try {
                const channelName = `team-chat-${message.workspace_id || message.project_id}`;
                (0, notificationServer_1.getNotificationServer)().broadcastToChannel(channelName, {
                    type: "MESSAGE_UPDATED",
                    message: message,
                });
            }
            catch (e) {
                logger_1.default.error("Error broadcasting update:", e);
            }
            return message;
        }
        catch (error) {
            logger_1.default.error("Error updating chat message:", error);
            throw error;
        }
    }
    /**
     * Delete a message (owner only or admin)
     */
    static async deleteMessage(messageId, userId) {
        try {
            // Check ownership
            const message = await prisma_1.default.teamChatMessage.findUnique({
                where: { id: messageId },
            });
            if (!message) {
                throw new Error("Message not found");
            }
            if (message.user_id !== userId) {
                throw new Error("Unauthorized");
            }
            await prisma_1.default.teamChatMessage.delete({
                where: { id: messageId },
            });
            // Broadcast to channel
            try {
                const channelName = `team-chat-${message.workspace_id || message.project_id}`;
                (0, notificationServer_1.getNotificationServer)().broadcastToChannel(channelName, {
                    type: "MESSAGE_DELETED",
                    messageId: messageId,
                });
            }
            catch (e) {
                logger_1.default.error("Error broadcasting delete:", e);
            }
            return { success: true };
        }
        catch (error) {
            logger_1.default.error("Error deleting chat message:", error);
            throw error;
        }
    }
    /**
     * Clear all messages in a workspace or project (admin/owner only)
     */
    static async clearChat(filter, userId) {
        try {
            // 1. Validate permissions
            if (filter.workspaceId) {
                const workspace = await prisma_1.default.workspace.findUnique({
                    where: { id: filter.workspaceId },
                    include: {
                        members: {
                            where: { user_id: userId },
                        },
                    },
                });
                if (!workspace) {
                    throw new Error("Workspace not found");
                }
                const isOwner = workspace.owner_id === userId;
                const member = workspace.members[0];
                const isAdmin = member?.role === "admin";
                if (!isOwner && !isAdmin) {
                    throw new Error("Unauthorized: Only workspace admins or owners can clear the workspace chat");
                }
            }
            if (filter.projectId) {
                const project = await prisma_1.default.project.findUnique({
                    where: { id: filter.projectId },
                    include: {
                        collaborators: {
                            where: { user_id: userId },
                        },
                    },
                });
                if (!project) {
                    throw new Error("Project not found");
                }
                const isOwner = project.user_id === userId;
                const collaborator = project.collaborators[0];
                const isAdminOrEditor = collaborator?.role === "admin" || collaborator?.role === "editor";
                if (!isOwner && !isAdminOrEditor) {
                    throw new Error("Unauthorized: Only project owners, admins, or editors can clear the project chat");
                }
            }
            const where = {
                workspace_id: filter.workspaceId,
                project_id: filter.projectId,
            };
            if (!where.workspace_id && !where.project_id) {
                throw new Error("Workspace or Project ID is required to clear chat");
            }
            const result = await prisma_1.default.teamChatMessage.deleteMany({
                where,
            });
            logger_1.default.info(`[CHAT] Chat cleared by user ${userId}`, {
                workspaceId: filter.workspaceId,
                projectId: filter.projectId,
                deletedCount: result.count,
            });
            return { success: true, count: result.count };
        }
        catch (error) {
            logger_1.default.error("Error clearing chat:", error);
            throw error;
        }
    }
    /**
     * Mark a message as read by a user
     */
    static async markMessageAsRead(messageId, userId) {
        try {
            await prisma_1.default.teamChatMessageRead.upsert({
                where: {
                    message_id_user_id: {
                        message_id: messageId,
                        user_id: userId,
                    },
                },
                create: {
                    message_id: messageId,
                    user_id: userId,
                },
                update: {}, // No change if already exists
            });
            // Broadcast to channel that message was read
            const message = await prisma_1.default.teamChatMessage.findUnique({
                where: { id: messageId },
                select: { workspace_id: true, project_id: true },
            });
            if (message) {
                const channelName = `team-chat-${message.workspace_id || message.project_id}`;
                (0, notificationServer_1.getNotificationServer)().broadcastToChannel(channelName, {
                    type: "MESSAGE_READ",
                    messageId,
                    userId,
                });
            }
            return { success: true };
        }
        catch (error) {
            logger_1.default.error("Error marking message as read:", error);
            throw error;
        }
    }
    /**
     * Update user presence status
     */
    static async updatePresence(userId, status) {
        try {
            const user = await prisma_1.default.user.update({
                where: { id: userId },
                data: {
                    online_status: status,
                    last_seen_at: new Date(),
                },
            });
            // Broadcast presence change to relevant workspaces (simplified: broadcast to all active user channels)
            // For now, we'll let the NotificationServer handle the broadness
            return user;
        }
        catch (error) {
            logger_1.default.error("Error updating user presence:", error);
            throw error;
        }
    }
}
exports.TeamChatService = TeamChatService;
exports.default = TeamChatService;
