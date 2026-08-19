import prisma from "../lib/prisma";
import logger from "../monitoring/logger";
import { createNotification } from "./notificationService";
import { getNotificationServer } from "../lib/notificationServer";

export interface TeamChatFilter {
  workspaceId?: string;
  projectId?: string;
  parentId?: string;
}

export class TeamChatService {
  /**
   * Fetch messages with basic threading support
   */
  static async getMessages(filter: TeamChatFilter, limit = 50, offset = 0) {
    try {
      const where: any = {
        workspace_id: filter.workspaceId,
        project_id: filter.projectId,
      };

      // Only filter by parent_id if explicitly requested
      if (filter.parentId !== undefined) {
        where.parent_id = filter.parentId || null;
      }

      const messages = await prisma.teamChatMessage.findMany({
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
    } catch (error) {
      logger.error("Error fetching chat messages:", error);
      throw error;
    }
  }

  /**
   * Send a new message
   */
  static async sendMessage(
    userId: string,
    content: string,
    filter: TeamChatFilter,
  ) {
    try {
      const message = await prisma.teamChatMessage.create({
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

      logger.info(`[CHAT] Message sent successfully: ${message.id}`, {
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
          if (mention.id === userId) continue; // Don't notify self

          await createNotification(
            mention.id,
            "mention",
            `New mention in ${contextName}`,
            `${sender.full_name || sender.email} mentioned you: "${content.substring(0, 50)}${content.length > 50 ? "..." : ""}"`,
            {
              workspaceId: filter.workspaceId,
              projectId: filter.projectId,
              messageId: message.id,
              senderId: userId,
              encryptedContent: content,
            },
          );
        }
      }

      // 2. Notify other members of the workspace/project who were NOT mentioned
      // We need to fetch members first
      try {
        let memberIds: string[] = [];

        if (filter.workspaceId) {
          const workspaceMembers = await prisma.workspaceMember.findMany({
            where: { workspace_id: filter.workspaceId },
            select: { user_id: true },
          });
          memberIds = workspaceMembers.map((m: any) => m.user_id);
        } else if (filter.projectId) {
          const projectCollaborators =
            await prisma.projectCollaborator.findMany({
              where: { project_id: filter.projectId },
              select: { user_id: true },
            });
          memberIds = projectCollaborators.map((c: any) => c.user_id);

          // Also include project owner
          const project = await prisma.project.findUnique({
            where: { id: filter.projectId },
            select: { user_id: true },
          });
          if (project) memberIds.push(project.user_id);
        }

        const mentionedIds = new Set(mentions.map((m) => m.id));
        const membersToNotify = memberIds.filter(
          (id) => id !== userId && !mentionedIds.has(id),
        );

        for (const targetUserId of membersToNotify) {
          await createNotification(
            targetUserId,
            "comment", // Using comment type for general messages
            `New message in ${contextName}`,
            `${sender.full_name || sender.email}: "${content.substring(0, 50)}${content.length > 50 ? "..." : ""}"`,
            {
              workspaceId: filter.workspaceId,
              projectId: filter.projectId,
              messageId: message.id,
              senderId: userId,
              isGeneralChat: true,
              encryptedContent: content,
            },
          );
        }
      } catch (notifyError) {
        logger.error("Error sending general chat notifications:", notifyError);
        // Don't throw, we don't want to break message sending if notifications fail
      }

      // Broadcast to custom WebSocket for real-time chat sync
      try {
        const { getNotificationServer } =
          await import("../lib/notificationServer.js");
        const channelName = `team-chat-${filter.workspaceId || filter.projectId}`;
        getNotificationServer().broadcastToChannel(channelName, {
          type: "NEW_MESSAGE",
          message: message,
        });
        logger.info(`Broadcasted NEW_MESSAGE to channel ${channelName}`);
      } catch (wsError) {
        logger.error("Error broadcasting chat message via WebSocket:", wsError);
      }

      return message;
    } catch (error) {
      logger.error("Error sending chat message:", error);
      throw error;
    }
  }

  /**
   * Update a message content
   */
  static async updateMessage(messageId: string, userId: string, content: string) {
    try {
      // Check ownership
      const existingMessage = await prisma.teamChatMessage.findUnique({
        where: { id: messageId },
      });

      if (!existingMessage) {
        throw new Error("Message not found");
      }

      if (existingMessage.user_id !== userId) {
        throw new Error("Unauthorized");
      }

      const message = await prisma.teamChatMessage.update({
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
        getNotificationServer().broadcastToChannel(channelName, {
          type: "MESSAGE_UPDATED",
          message: message,
        });
      } catch (e) {
        logger.error("Error broadcasting update:", e);
      }

      return message;
    } catch (error) {
      logger.error("Error updating chat message:", error);
      throw error;
    }
  }

  /**
   * Delete a message (owner only or admin)
   */
  static async deleteMessage(messageId: string, userId: string) {
    try {
      // Check ownership
      const message = await prisma.teamChatMessage.findUnique({
        where: { id: messageId },
      });

      if (!message) {
        throw new Error("Message not found");
      }

      if (message.user_id !== userId) {
        throw new Error("Unauthorized");
      }

      await prisma.teamChatMessage.delete({
        where: { id: messageId },
      });

      // Broadcast to channel
      try {
        const channelName = `team-chat-${message.workspace_id || message.project_id}`;
        getNotificationServer().broadcastToChannel(channelName, {
          type: "MESSAGE_DELETED",
          messageId: messageId,
        });
      } catch (e) {
        logger.error("Error broadcasting delete:", e);
      }

      return { success: true };
    } catch (error) {
      logger.error("Error deleting chat message:", error);
      throw error;
    }
  }

  /**
   * Clear all messages in a workspace or project (admin/owner only)
   */
  static async clearChat(filter: TeamChatFilter, userId: string) {
    try {
      // 1. Validate permissions
      if (filter.workspaceId) {
        const workspace = await prisma.workspace.findUnique({
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
          throw new Error(
            "Unauthorized: Only workspace admins or owners can clear the workspace chat",
          );
        }
      }

      if (filter.projectId) {
        const project = await prisma.project.findUnique({
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
        const isAdminOrEditor =
          collaborator?.role === "admin" || collaborator?.role === "editor";

        if (!isOwner && !isAdminOrEditor) {
          throw new Error(
            "Unauthorized: Only project owners, admins, or editors can clear the project chat",
          );
        }
      }

      const where: any = {
        workspace_id: filter.workspaceId,
        project_id: filter.projectId,
      };

      if (!where.workspace_id && !where.project_id) {
        throw new Error("Workspace or Project ID is required to clear chat");
      }

      const result = await prisma.teamChatMessage.deleteMany({
        where,
      });

      logger.info(`[CHAT] Chat cleared by user ${userId}`, {
        workspaceId: filter.workspaceId,
        projectId: filter.projectId,
        deletedCount: result.count,
      });

      return { success: true, count: result.count };
    } catch (error) {
      logger.error("Error clearing chat:", error);
      throw error;
    }
  }

  /**
   * Mark a message as read by a user
   */
  static async markMessageAsRead(messageId: string, userId: string) {
    try {
      await prisma.teamChatMessageRead.upsert({
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
      const message = await prisma.teamChatMessage.findUnique({
        where: { id: messageId },
        select: { workspace_id: true, project_id: true },
      });

      if (message) {
        const channelName = `team-chat-${message.workspace_id || message.project_id}`;
        getNotificationServer().broadcastToChannel(channelName, {
          type: "MESSAGE_READ",
          messageId,
          userId,
        });
      }

      return { success: true };
    } catch (error) {
      logger.error("Error marking message as read:", error);
      throw error;
    }
  }

  /**
   * Update user presence status
   */
  static async updatePresence(userId: string, status: string) {
    try {
      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          online_status: status,
          last_seen_at: new Date(),
        },
      });

      // Broadcast presence change to relevant workspaces (simplified: broadcast to all active user channels)
      // For now, we'll let the NotificationServer handle the broadness
      return user;
    } catch (error) {
      logger.error("Error updating user presence:", error);
      throw error;
    }
  }
}

export default TeamChatService;
