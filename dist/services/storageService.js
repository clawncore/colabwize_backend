"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageService = void 0;
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
class StorageService {
    /**
     * Get user's storage information
     */
    static async getUserStorageInfo(userId) {
        try {
            const user = await prisma_1.prisma.user.findUnique({
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
        }
        catch (error) {
            logger_1.default.error("Error getting user storage info", {
                userId,
                error: error.message,
            });
            throw error;
        }
    }
    /**
     * Get storage limit based on user's subscription
     */
    static getStorageLimitForUser(user) {
        // This would typically check the user's subscription plan
        // For MVP, return default values
        return 1000; // 1GB default limit
    }
    /**
     * Update user's storage usage
     */
    static async updateUserStorage(userId, additionalUsed) {
        try {
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
            });
            if (!user) {
                throw new Error("User not found");
            }
            const newStorageUsed = Math.max(0, (user.storage_used || 0) + additionalUsed);
            await prisma_1.prisma.user.update({
                where: { id: userId },
                data: {
                    storage_used: newStorageUsed,
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error updating user storage", {
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
    static async hasEnoughStorage(userId, requiredSpace) {
        const storageInfo = await this.getUserStorageInfo(userId);
        return storageInfo.used + requiredSpace <= storageInfo.limit;
    }
}
exports.StorageService = StorageService;
