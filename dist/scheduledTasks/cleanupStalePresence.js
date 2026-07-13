"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleCleanupTask = scheduleCleanupTask;
const collaboratorPresenceService_1 = require("../services/collaboratorPresenceService");
const logger_1 = __importDefault(require("../monitoring/logger"));
// Function to clean up stale presence records
async function cleanupStalePresence() {
    try {
        logger_1.default.info("Starting cleanup of stale collaborator presence records");
        const deletedCount = await collaboratorPresenceService_1.CollaboratorPresenceService.cleanupStalePresence(30); // Clean up records older than 30 minutes
        logger_1.default.info(`Cleaned up ${deletedCount} stale collaborator presence records`);
    }
    catch (error) {
        logger_1.default.error("Error cleaning up stale collaborator presence records:", error);
    }
}
// Schedule the cleanup task to run every 15 minutes
function scheduleCleanupTask() {
    // Run immediately when the server starts
    cleanupStalePresence();
    // Schedule to run every 15 minutes
    setInterval(cleanupStalePresence, 15 * 60 * 1000); // 15 minutes
    logger_1.default.info(`Scheduled collaborator presence cleanup task to run every 15 minutes`);
}
