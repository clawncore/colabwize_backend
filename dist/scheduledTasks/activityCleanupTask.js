"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleActivityCleanupTask = scheduleActivityCleanupTask;
/**
 * scheduleActivityCleanupTask
 *
 * Deletes AuthorshipActivity and RealTimeActivity records older than 7 days.
 * Runs daily at 02:00 server time.
 */
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
function scheduleActivityCleanupTask() {
    const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000; // Every 24 hours
    const runCleanup = async () => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 7);
        try {
            // Delete old real-time activity records (keystroke-level, large volume)
            const deletedRealTime = await prisma_1.prisma.realTimeActivity.deleteMany({
                where: {
                    timestamp: { lt: cutoff },
                },
            });
            // Delete old authorship activity summaries
            const deletedAuthorship = await prisma_1.prisma.authorshipActivity.deleteMany({
                where: {
                    session_start: { lt: cutoff },
                },
            });
            logger_1.default.info("Activity cleanup completed", {
                deletedRealTimeActivities: deletedRealTime.count,
                deletedAuthorshipActivities: deletedAuthorship.count,
                cutoffDate: cutoff.toISOString(),
            });
        }
        catch (error) {
            logger_1.default.error("Activity cleanup failed", { error: error.message });
        }
    };
    // Run immediately on startup (catches anything old from downtime)
    runCleanup();
    // Then every 24 hours
    setInterval(runCleanup, RUN_INTERVAL_MS);
    logger_1.default.info("Activity cleanup task scheduled (runs every 24h, 7-day retention)");
}
