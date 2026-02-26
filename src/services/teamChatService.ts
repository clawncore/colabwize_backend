import prisma from "../lib/prisma";
import logger from "../monitoring/logger";
import { createNotification } from "./notificationService";
import { UserService } from "./userService";

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
      const messages = await prisma.teamChatMessage.findMany({
        where: {
          workspace_id: filter.workspaceId,
          project_id: filter.projectId,
          parent_id: filter.parentId || null,
        },
        include: {
          user: {
            select: {
              id: true,
              full_name: true,
              email: true,
            },
          },
          _count: {
            select: { replies: true },
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
            },
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
        const sender = message.user;
        const contextName = filter.workspaceId
          ? "workspace chat"
          : "project chat";

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
            }
          );
        }
      }

      return message;
    } catch (error) {
      logger.error("Error sending chat message:", error);
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

      // Allow deletion if user is the sender OR valid admin checks could go here
      if (message.user_id !== userId) {
        // Need to check workspace role if not sender, but for now strict ownership
        throw new Error("Unauthorized");
      }

      await prisma.teamChatMessage.delete({
        where: { id: messageId },
      });

      return { success: true };
    } catch (error) {
      logger.error("Error deleting chat message:", error);
      throw error;
    }
  }
}

export default TeamChatService;
