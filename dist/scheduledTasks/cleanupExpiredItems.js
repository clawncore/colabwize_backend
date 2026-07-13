"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleCleanupTask = scheduleCleanupTask;
const recycleBinService_1 = require("../services/recycleBinService");
const logger_1 = __importDefault(require("../monitoring/logger"));
// Function to clean up expired items from the recycle bin
async function cleanupExpiredItems() {
    try {
        logger_1.default.info("Starting cleanup of expired recycle bin items");
        const deletedCount = await recycleBinService_1.RecycleBinService.deleteExpiredItems();
        logger_1.default.info(`Cleaned up ${deletedCount} expired recycle bin items`);
    }
    catch (error) {
        logger_1.default.error("Error cleaning up expired recycle bin items:", error);
    }
}
// Schedule the cleanup task to run daily at midnight
function scheduleCleanupTask() {
    // Run immediately when the server starts
    cleanupExpiredItems();
    // Schedule to run daily at midnight (00:00)
    const now = new Date();
    const nextRun = new Date();
    nextRun.setHours(24, 0, 0, 0); // Next midnight
    const timeUntilNextRun = nextRun.getTime() - now.getTime();
    setTimeout(() => {
        // Run the cleanup task
        cleanupExpiredItems();
        // Set up interval to run daily
        setInterval(cleanupExpiredItems, 24 * 60 * 60 * 1000); // 24 hours
    }, timeUntilNextRun);
    logger_1.default.info(`Scheduled recycle bin cleanup task to run daily at midnight`);
}
