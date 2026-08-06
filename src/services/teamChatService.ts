import logger from "../monitoring/logger";
import { prisma } from "../lib/prisma";
import { getNotificationServer } from "../lib/notificationServer";
import { createNotification } from "./notificationService";

export interface TeamChatFilter {
  workspaceId?: string;
  projectId?: string;
  parentId?: string;
}

export class CommentService {
  static async getMessages(
    filter: TeamChatFilter,
    limit = 50,
    offset = 0,
  ) {
    try {
      const where: any = {};
      if (filter.workspaceId) where.workspace_id = filter.workspaceId;
      if (filter.projectId) where.project_id = filter.projectId;

      const messages = await prisma.teamChatMessage.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset,
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
            select: {
              id: true,
              content: true,
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
              read_by: true,
            },
          },
        },
      });

      return messages;
    } catch (error) {
      logger.error("Error fetching messages:", error);
      throw new Error("Failed to fetch messages");
    }
  }

  static async getThreadMessages(parentId: string) {
    try {
      const messages = await prisma.teamChatMessage.findMany({
        where: { parent_id: parentId },
        orderBy: { created_at: "asc" },
        include: {
          user: {
            select: {
              id: true,
              full_name: true,
              email: true,
              avatar_url: true,
            },
          },
          _count: {
            select: {
              replies: true,
              read_by: true,
            },
          },
        },
      });
      return messages;
    } catch (error) {
      logger.error("Error fetching thread messages:", error);
      throw new Error("Failed to fetch thread messages");
    }
  }

  static async sendMessage(
    userId: string,
    content: string,
    filter: TeamChatFilter,
  ) {
    try {
      if (!content.trim()) throw new Error("Message content is required");

      if (!filter.workspaceId && !filter.projectId) {
        throw new Error("workspaceId or projectId is required");
      }

      const message = await prisma.teamChatMessage.create({
        data: {
          user_id: userId,
          content: content.trim(),
          workspace_id: filter.workspaceId || null,
          project_id: filter.projectId || null,
          parent_id: filter.parentId || null,
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
            select: {
              id: true,
              content: true,
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

      const mentions = this.extractMentions(content);
      if (mentions.length > 0) {
        const mentionedUsers = await prisma.user.findMany({
          where: { id: { in: mentions } },
          select: { id: true, email: true },
        });

        for (const mentionedUser of mentionedUsers) {
          if (mentionedUser.id !== userId) {
            try {
              await createNotification(
                mentionedUser.id,
                "mention",
                "You were mentioned in a comment",
                content.substring(0, 150),
                {
                  commentId: message.id,
                  projectId: filter.projectId,
                  workspaceId: filter.workspaceId,
                  mentionedBy: userId,
                },
              );
            } catch (notifError: any) {
              logger.error("Failed to create mention notification", {
                error: notifError.message,
              });
            }
          }
        }
      }

      if (filter.parentId) {
        const parentMessage = await prisma.teamChatMessage.findUnique({
          where: { id: filter.parentId },
          select: { user_id: true },
        });

        if (parentMessage && parentMessage.user_id !== userId) {
          try {
            await createNotification(
              parentMessage.user_id,
              "comment",
              "New reply to your comment",
              content.substring(0, 150),
              {
                commentId: message.id,
                parentId: filter.parentId,
                projectId: filter.projectId,
                workspaceId: filter.workspaceId,
                repliedBy: userId,
              },
            );
          } catch (notifError: any) {
            logger.error("Failed to create reply notification", {
              error: notifError.message,
            });
          }
        }
      }

      const channel = filter.workspaceId
        ? `team-chat-${filter.workspaceId}`
        : `team-chat-${filter.projectId}`;

      try {
        const notificationServer = getNotificationServer();
        if (notificationServer) {
          notificationServer.broadcastToChannel(channel, {
            type: "NEW_MESSAGE",
            message,
          });
        }
      } catch (wsError: any) {
        logger.error("WebSocket broadcast failed:", wsError.message);
      }

      return message;
    } catch (error: any) {
      logger.error("Error sending message:", error);
      throw error;
    }
  }

  static async updateMessage(
    messageId: string,
    userId: string,
    content: string,
  ) {
    try {
      const message = await prisma.teamChatMessage.findUnique({
        where: { id: messageId },
      });
      if (!message) throw new Error("Message not found");
      if (message.user_id !== userId) throw new Error("Unauthorized");

      const updated = await prisma.teamChatMessage.update({
        where: { id: messageId },
        data: { content: content.trim() },
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
      });

      const channel = updated.workspace_id
        ? `team-chat-${updated.workspace_id}`
        : `team-chat-${updated.project_id}`;

      try {
        const notificationServer = getNotificationServer();
        if (notificationServer) {
          notificationServer.broadcastToChannel(channel, {
            type: "MESSAGE_UPDATED",
            message: updated,
          });
        }
      } catch (wsError: any) {
        logger.error("WebSocket broadcast failed:", wsError.message);
      }

      return updated;
    } catch (error: any) {
      logger.error("Error updating message:", error);
      throw error;
    }
  }

  static async updateMessageStatus(
    messageId: string,
    userId: string,
    status: string,
  ) {
    try {
      const message = await prisma.teamChatMessage.findUnique({
        where: { id: messageId },
      });
      if (!message) throw new Error("Message not found");
      if (message.user_id !== userId) throw new Error("Unauthorized");

      const updated = await prisma.teamChatMessage.update({
        where: { id: messageId },
        data: { status },
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
      });

      const channel = updated.workspace_id
        ? `team-chat-${updated.workspace_id}`
        : `team-chat-${updated.project_id}`;

      try {
        const notificationServer = getNotificationServer();
        if (notificationServer) {
          notificationServer.broadcastToChannel(channel, {
            type: "MESSAGE_STATUS_UPDATED",
            message: updated,
          });
        }
      } catch (wsError: any) {
        logger.error("WebSocket broadcast failed:", wsError.message);
      }

      return updated;
    } catch (error: any) {
      logger.error("Error updating message status:", error);
      throw error;
    }
  }

  static async deleteMessage(messageId: string, userId: string) {
    try {
      const message = await prisma.teamChatMessage.findUnique({
        where: { id: messageId },
      });
      if (!message) throw new Error("Message not found");
      if (message.user_id !== userId) throw new Error("Unauthorized");

      await prisma.teamChatMessage.delete({ where: { id: messageId } });

      const channel = message.workspace_id
        ? `team-chat-${message.workspace_id}`
        : `team-chat-${message.project_id}`;

      try {
        const notificationServer = getNotificationServer();
        if (notificationServer) {
          notificationServer.broadcastToChannel(channel, {
            type: "MESSAGE_DELETED",
            messageId,
          });
        }
      } catch (wsError: any) {
        logger.error("WebSocket broadcast failed:", wsError.message);
      }

      return { success: true };
    } catch (error: any) {
      logger.error("Error deleting message:", error);
      throw error;
    }
  }

  static async markMessageAsRead(messageId: string, userId: string) {
    try {
      await prisma.teamChatMessageRead.upsert({
        where: {
          message_id_user_id: {
            message_id: messageId,
            user_id: userId,
          },
        },
        update: { read_at: new Date() },
        create: {
          message_id: messageId,
          user_id: userId,
        },
      });

      const channel = `team-chat-read-${messageId}`;
      try {
        const notificationServer = getNotificationServer();
        if (notificationServer) {
          notificationServer.broadcastToChannel(channel, {
            type: "MESSAGE_READ",
            messageId,
            userId,
          });
        }
      } catch (wsError: any) {
        logger.error("WebSocket broadcast failed:", wsError.message);
      }

      return { success: true };
    } catch (error: any) {
      logger.error("Error marking message as read:", error);
      throw error;
    }
  }

  static extractMentions(content: string): string[] {
    const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)/g;
    const mentions: string[] = [];
    let match;
    while ((match = mentionRegex.exec(content)) !== null) {
      mentions.push(match[2]);
    }
    return mentions;
  }

  /**
   * Update a user's presence status in the database.
   * This persists online_status and last_seen_at to the User model.
   */
  static async updatePresence(userId: string, status: string): Promise<void> {
    try {
      const { prisma } = await import("../../lib/prisma.js");
      
      // Update the User model with online status and last seen timestamp
      await prisma.user.update({
        where: { id: userId },
        data: {
          online_status: status,
          last_seen_at: new Date(),
        },
      });
      
      logger.debug(`[Presence] Updated user presence: userId=${userId} status=${status}`);
    } catch (error) {
      logger.error(`[Presence] Failed to update user presence: userId=${userId}`, error);
    }
  }

  /**
   * Get all currently online users from the database.
   * Users are considered online if online_status is 'online'.
   * We trust the WebSocket disconnect handler to set status to 'offline'.
   */
  static async getOnlineUsers(): Promise<{ id: string; email: string; full_name: string | null; last_seen_at: Date; online_status: string }[]> {
    try {
      const { prisma } = await import("../../lib/prisma.js");
      
      const onlineUsers = await prisma.user.findMany({
        where: {
          online_status: "online",
        },
        select: {
          id: true,
          email: true,
          full_name: true,
          last_seen_at: true,
          online_status: true,
        },
        orderBy: { last_seen_at: "desc" },
      });
      
      return onlineUsers;
    } catch (error) {
      logger.error("[Presence] Failed to fetch online users", error);
      return [];
    }
  }

  /**
   * Get presence statistics for the admin dashboard.
   * Returns real counts of online, away, and offline users.
   */
  static async getPresenceStats(): Promise<{
    online: number;
    away: number;
    offline: number;
    total: number;
    recentlyActive: number;
    onlineUsers: { id: string; email: string; full_name: string | null; last_seen_at: Date | null; online_status: string | null; subscription: { plan: string; status: string } | null }[];
  }> {
    try {
      const { prisma } = await import("../../lib/prisma.js");
      
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      // Count users by status - trust online_status field
      const [onlineCount, awayCount, offlineCount, totalCount, recentlyActiveCount] = await Promise.all([
        prisma.user.count({
          where: {
            online_status: "online",
          },
        }),
        prisma.user.count({
          where: {
            online_status: "away",
          },
        }),
        prisma.user.count({
          where: {
            OR: [
              { online_status: "offline" },
              { online_status: null },
            ],
          },
        }),
        prisma.user.count(),
        prisma.user.count({
          where: {
            last_seen_at: { gte: oneDayAgo },
          },
        }),
      ]);
      
      // Get currently online users with details
      const onlineUsers = await prisma.user.findMany({
        where: {
          online_status: "online",
        },
        select: {
          id: true,
          email: true,
          full_name: true,
          last_seen_at: true,
          online_status: true,
          subscription: {
            select: { plan: true, status: true },
          },
        },
        orderBy: { last_seen_at: "desc" },
        take: 50, // Limit to prevent oversized responses
      });
      
      return {
        online: onlineCount,
        away: awayCount,
        offline: offlineCount,
        total: totalCount,
        recentlyActive: recentlyActiveCount,
        onlineUsers,
      };
    } catch (error) {
      logger.error("[Presence] Failed to fetch presence stats", error);
      return {
        online: 0,
        away: 0,
        offline: 0,
        total: 0,
        recentlyActive: 0,
        onlineUsers: [],
      };
    }
  }
}

// Backward-compatible alias used by older imports
export { CommentService as TeamChatService };
