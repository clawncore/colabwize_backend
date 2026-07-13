"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PushNotificationService = void 0;
const logger_1 = __importDefault(require("../monitoring/logger"));
const prisma_1 = require("../lib/prisma");
class PushNotificationService {
    // Register a push notification token for a user in the database
    static async registerToken(userId, token) {
        try {
            // Store token in database
            await prisma_1.prisma.pushNotificationToken.upsert({
                where: {
                    user_id_token: {
                        user_id: userId,
                        token: token,
                    },
                },
                update: {
                    updated_at: new Date(),
                },
                create: {
                    user_id: userId,
                    token: token,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
            });
            logger_1.default.info(`Push notification token registered for user ${userId}`);
        }
        catch (error) {
            logger_1.default.error("Error registering push notification token:", error);
            throw error;
        }
    }
    // Unregister a push notification token for a user from the database
    static async unregisterToken(userId, token) {
        try {
            await prisma_1.prisma.pushNotificationToken.deleteMany({
                where: {
                    user_id: userId,
                    token: token,
                },
            });
            logger_1.default.info(`Push notification token unregistered for user ${userId}`);
        }
        catch (error) {
            logger_1.default.error("Error unregistering push notification token:", error);
            throw error;
        }
    }
    // Get all push notification tokens for a user
    static async getUserTokens(userId) {
        try {
            const tokens = await prisma_1.prisma.pushNotificationToken.findMany({
                where: {
                    user_id: userId,
                },
                select: {
                    token: true,
                },
            });
            return tokens.map((t) => t.token);
        }
        catch (error) {
            logger_1.default.error("Error getting user push notification tokens:", error);
            return [];
        }
    }
    static async getPushNotificationTokensForUser(userId) {
        try {
            const tokens = await prisma_1.prisma.pushNotificationToken.findMany({
                where: { user_id: userId },
                select: { token: true },
            });
            return tokens.map((t) => t.token);
        }
        catch (error) {
            console.error("Error getting push notification tokens:", error);
            return [];
        }
    }
    // Send push notification to a user (simulated)
    static async sendToUser(userId, title, body, data) {
        try {
            const tokens = await this.getUserTokens(userId);
            if (tokens.length === 0) {
                logger_1.default.info(`No push notification tokens found for user ${userId}`);
                return;
            }
            // Simulate push notification
            logger_1.default.info(`Simulating push notification to user ${userId}: ${title} - ${body}`);
        }
        catch (error) {
            logger_1.default.error("Error sending push notification:", error);
            throw error;
        }
    }
    // Send push notification to multiple users
    static async sendToUsers(userIds, title, body, data) {
        for (const userId of userIds) {
            await this.sendToUser(userId, title, body, data);
        }
    }
    // Broadcast push notification to all users (simulated)
    static async broadcast(title, body, data) {
        try {
            // Simulate broadcast
            logger_1.default.info(`Simulating broadcast push notification: ${title} - ${body}`);
        }
        catch (error) {
            logger_1.default.error("Error broadcasting push notification:", error);
            throw error;
        }
    }
    static async cleanUpExpiredTokens() {
        try {
            // First, get all tokens with their creation timestamps
            const allTokensRecords = await prisma_1.prisma.pushNotificationToken.findMany({
                select: { id: true, token: true, created_at: true },
            });
            // Filter expired tokens (older than 30 days)
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            const expiredTokens = allTokensRecords.filter((record) => {
                // Check if token was created more than 30 days ago
                return record.created_at < thirtyDaysAgo;
            });
            if (expiredTokens.length > 0) {
                const expiredIds = expiredTokens.map((record) => record.id);
                await prisma_1.prisma.pushNotificationToken.deleteMany({
                    where: { id: { in: expiredIds } },
                });
                console.log(`Cleaned up ${expiredTokens.length} expired push notification tokens`);
            }
        }
        catch (error) {
            console.error("Error cleaning up expired tokens:", error);
        }
    }
}
exports.PushNotificationService = PushNotificationService;
exports.default = PushNotificationService;
