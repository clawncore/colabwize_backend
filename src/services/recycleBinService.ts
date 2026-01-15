import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

// Define the RecycledItem type based on what the frontend expects
interface RecycledItem {
  id: string;
  user_id: string;
  item_type: string;
  item_data: any; // JSON field containing the item's data
  deleted_at: Date;
  expires_at: Date;
  restored_at: Date | null;
}

interface RecycleBinStats {
  totalItems: number;
  expiredItems: number;
  restoredItems: number;
  daysUntilPurge: number;
}

export class RecycleBinService {
  /**
   * Get all recycled items for a user
   */
  static async getUserRecycledItems(
    userId: string,
    itemType?: string
  ): Promise<RecycledItem[]> {
    try {
      const whereClause: any = {
        user_id: userId,
        restored_at: null, // Only non-restored items
      };

      if (itemType) {
        whereClause.item_type = itemType;
      }

      const items = await prisma.recycledItem.findMany({
        where: whereClause,
        orderBy: {
          deleted_at: "desc",
        },
      });

      return items;
    } catch (error) {
      logger.error("Error getting user recycled items:", error);
      throw error;
    }
  }

  /**
   * Restore an item from the recycle bin
   */
  static async restoreItem(
    userId: string,
    recycledItemId: string
  ): Promise<RecycledItem> {
    try {
      // Verify the item belongs to the user
      const item = await prisma.recycledItem.findFirst({
        where: {
          id: recycledItemId,
          user_id: userId,
          restored_at: null, // Only if not already restored
        },
      });

      if (!item) {
        throw new Error("Item not found or already restored");
      }

      // Update the item to mark it as restored
      const restoredItem = await prisma.recycledItem.update({
        where: {
          id: recycledItemId,
        },
        data: {
          restored_at: new Date(),
        },
      });

      // Restore the original item based on its type
      await this.restoreOriginalItem(item);

      return restoredItem;
    } catch (error) {
      logger.error("Error restoring item:", error);
      throw error;
    }
  }

  /**
   * Permanently delete an item from the recycle bin
   */
  static async permanentlyDeleteItem(
    userId: string,
    recycledItemId: string
  ): Promise<void> {
    try {
      // Verify the item belongs to the user and hasn't been restored
      const item = await prisma.recycledItem.findFirst({
        where: {
          id: recycledItemId,
          user_id: userId,
          restored_at: null, // Only non-restored items
        },
      });

      if (!item) {
        throw new Error("Item not found or already processed");
      }

      // Permanently delete the recycled item record
      await prisma.recycledItem.delete({
        where: {
          id: recycledItemId,
        },
      });
    } catch (error) {
      logger.error("Error permanently deleting item:", error);
      throw error;
    }
  }

  /**
   * Get recycle bin statistics for a user
   */
  static async getRecycleBinStats(userId: string): Promise<RecycleBinStats> {
    try {
      const now = new Date();

      const totalItems = await prisma.recycledItem.count({
        where: {
          user_id: userId,
          restored_at: null,
        },
      });

      const expiredItems = await prisma.recycledItem.count({
        where: {
          user_id: userId,
          restored_at: null,
          expires_at: {
            lt: now,
          },
        },
      });

      const restoredItems = await prisma.recycledItem.count({
        where: {
          user_id: userId,
          restored_at: {
            not: null,
          },
        },
      });

      // Find the earliest expiration date for non-restored items
      const earliestExpiration = await prisma.recycledItem.findFirst({
        where: {
          user_id: userId,
          restored_at: null,
        },
        orderBy: {
          expires_at: "asc",
        },
        select: {
          expires_at: true,
        },
      });

      const daysUntilPurge = earliestExpiration
        ? Math.ceil(
            (earliestExpiration.expires_at.getTime() - now.getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : 0;

      return {
        totalItems,
        expiredItems,
        restoredItems,
        daysUntilPurge,
      };
    } catch (error) {
      logger.error("Error getting recycle bin stats:", error);
      throw error;
    }
  }

  /**
   * Set user's retention period for recycle bin items
   */
  static async setUserRetentionPeriod(
    userId: string,
    retentionPeriod: number
  ): Promise<void> {
    try {
      // Update the user's retention period preference
      // We'll store this in the user table or create a separate settings table if needed
      await prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          retention_period: retentionPeriod,
        },
      });
    } catch (error) {
      logger.error("Error setting user retention period:", error);
      throw error;
    }
  }

  /**
   * Get user's retention period for recycle bin items
   */
  static async getUserRetentionPeriod(userId: string): Promise<number> {
    try {
      const user = await prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          retention_period: true,
        },
      });

      // Return the user's retention period or default to 28 days
      return user?.retention_period || 28;
    } catch (error) {
      logger.error("Error getting user retention period:", error);
      throw error;
    }
  }

  /**
   * Add an item to the recycle bin
   */
  static async addItemToRecycleBin(
    userId: string,
    itemType: string,
    itemData: any
  ): Promise<RecycledItem> {
    try {
      // Get the user's retention period
      const retentionPeriod = await this.getUserRetentionPeriod(userId);

      // Calculate expiration date
      const deletedAt = new Date();
      const expiresAt = new Date(deletedAt);
      expiresAt.setDate(expiresAt.getDate() + retentionPeriod);

      // Create the recycled item record
      const recycledItem = await prisma.recycledItem.create({
        data: {
          user_id: userId,
          item_type: itemType,
          item_data: itemData,
          deleted_at: deletedAt,
          expires_at: expiresAt,
        },
      });

      return recycledItem;
    } catch (error) {
      logger.error("Error adding item to recycle bin:", error);
      throw error;
    }
  }

  /**
   * Restore the original item based on its type
   */
  private static async restoreOriginalItem(item: RecycledItem): Promise<void> {
    try {
      switch (item.item_type) {
        case "project":
          await this.restoreProject(item);
          break;
        case "template":
          await this.restoreTemplate(item);
          break;
        case "citation":
          await this.restoreCitation(item);
          break;
        case "api_key":
          await this.restoreApiKey(item);
          break;
        default:
          logger.warn(`Unknown item type for restoration: ${item.item_type}`);
          break;
      }
    } catch (error) {
      logger.error(
        `Error restoring original item of type ${item.item_type}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Restore a project from the recycle bin
   */
  private static async restoreProject(item: RecycledItem): Promise<void> {
    // Extract project data from item_data
    const projectData = item.item_data;

    // Restore the project in the database
    await prisma.project.create({
      data: {
        user_id: item.user_id,
        title: projectData.title || "Restored Project",
        description: projectData.description || "",
        content: projectData.content || {},
        word_count: projectData.word_count || 0,
        file_path: projectData.file_path || null,
        file_type: projectData.file_type || null,
      },
    });
  }

  /**
   * Restore a template from the recycle bin
   */
  private static async restoreTemplate(item: RecycledItem): Promise<void> {
    // Extract template data from item_data
    const templateData = item.item_data;

    // For now, we'll just log that we would restore a template
    logger.info(`Would restore template: ${JSON.stringify(templateData)}`);
  }

  /**
   * Restore a citation from the recycle bin
   */
  private static async restoreCitation(item: RecycledItem): Promise<void> {
    // Extract citation data from item_data
    const citationData = item.item_data;

    // Restore the citation in the database
    await prisma.citation.create({
      data: {
        user_id: item.user_id,
        project_id: citationData.project_id || "",
        title: citationData.title || "Restored Citation",
        author: citationData.author || "Unknown Author",
        year: citationData.year || new Date().getFullYear(),
        type: citationData.type || "journal",
        doi: citationData.doi || null,
        url: citationData.url || null,
        volume: citationData.volume || null,
        issue: citationData.issue || null,
        pages: citationData.pages || null,
        publisher: citationData.publisher || null,
        journal: citationData.journal || null,
        citation_count: citationData.citation_count || null,
        is_reliable:
          citationData.is_reliable !== undefined
            ? citationData.is_reliable
            : true,
      },
    });
  }

  /**
   * Restore an API key from the recycle bin
   */
  private static async restoreApiKey(item: RecycledItem): Promise<void> {
    // Extract API key data from item_data
    const apiKeyData = item.item_data;

    // For now, we'll just log that we would restore an API key
    logger.info(`Would restore API key: ${JSON.stringify(apiKeyData)}`);
  }

  /**
   * Clean up expired items from the recycle bin
   */
  static async cleanupExpiredItems(): Promise<void> {
    try {
      const now = new Date();

      // Find items that have expired and haven't been restored
      const expiredItems = await prisma.recycledItem.findMany({
        where: {
          expires_at: {
            lt: now,
          },
          restored_at: null,
        },
      });

      // Delete each expired item permanently
      for (const item of expiredItems) {
        await prisma.recycledItem.delete({
          where: {
            id: item.id,
          },
        });
      }

      logger.info(
        `Cleaned up ${expiredItems.length} expired items from recycle bin`
      );
    } catch (error) {
      logger.error("Error cleaning up expired items:", error);
      throw error;
    }
  }

  /**
   * Schedule automatic cleanup of expired items
   */
  static async scheduleCleanup(): Promise<void> {
    // Run cleanup every hour
    setInterval(
      async () => {
        try {
          await this.cleanupExpiredItems();
        } catch (error) {
          logger.error("Error in scheduled recycle bin cleanup:", error);
        }
      },
      60 * 60 * 1000
    ); // Every hour

    logger.info("Recycle bin cleanup scheduler started");
  }
}
