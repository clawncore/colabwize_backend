import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

interface StorageInfo {
  used: number; // in MB
  limit: number; // in MB
}

export class StorageService {
  /**
   * Get user's storage information
   */
  static async getUserStorageInfo(userId: string): Promise<StorageInfo> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error("User not found");
      }

      // Return storage info - default limits based on subscription
      const storageLimit = this.getStorageLimitForUser(user);

      return {
        used: user.storage_used || 0,
        limit: storageLimit,
      };
    } catch (error: any) {
      logger.error("Error getting user storage info", {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get storage limit based on user's subscription
   */
  private static getStorageLimitForUser(user: any): number {
    // This would typically check the user's subscription plan
    // For MVP, return default values
    return 1000; // 1GB default limit
  }

  /**
   * Update user's storage usage
   */
  static async updateUserStorage(
    userId: string,
    additionalUsed: number
  ): Promise<void> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error("User not found");
      }

      const newStorageUsed = Math.max(
        0,
        (user.storage_used || 0) + additionalUsed
      );

      await prisma.user.update({
        where: { id: userId },
        data: {
          storage_used: newStorageUsed,
        },
      });
    } catch (error: any) {
      logger.error("Error updating user storage", {
        userId,
        additionalUsed,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Check if user has enough storage space
   */
  static async hasEnoughStorage(
    userId: string,
    requiredSpace: number
  ): Promise<boolean> {
    const storageInfo = await this.getUserStorageInfo(userId);
    return storageInfo.used + requiredSpace <= storageInfo.limit;
  }
}
