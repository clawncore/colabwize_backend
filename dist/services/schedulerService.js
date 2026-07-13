"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const webhookRetryService_js_1 = __importDefault(require("./webhookRetryService.js"));
const logger_1 = __importDefault(require("../monitoring/logger"));
/**
 * SchedulerService handles periodic tasks for the application
 */
class SchedulerService {
    static instance;
    intervals = [];
    constructor() { }
    static getInstance() {
        if (!SchedulerService.instance) {
            SchedulerService.instance = new SchedulerService();
        }
        return SchedulerService.instance;
    }
    /**
     * Start all scheduled tasks
     */
    start() {
        logger_1.default.info("Starting scheduler service");
        // Run backup sync every hour
        const backupSyncInterval = setInterval(() => {
            this.runBackupSync();
        }, 60 * 60 * 1000); // 1 hour
        this.intervals.push(backupSyncInterval);
        // Run cleanup of old failed webhooks daily
        const cleanupInterval = setInterval(() => {
            this.cleanupOldFailedWebhooks();
        }, 24 * 60 * 60 * 1000); // 24 hours
        this.intervals.push(cleanupInterval);
        logger_1.default.info("Scheduler service started with 2 tasks");
    }
    /**
     * Stop all scheduled tasks
     */
    stop() {
        logger_1.default.info("Stopping scheduler service");
        this.intervals.forEach((interval) => {
            clearInterval(interval);
        });
        this.intervals = [];
        logger_1.default.info("Scheduler service stopped");
    }
    /**
     * Run backup sync for failed webhooks
     */
    async runBackupSync() {
        try {
            logger_1.default.info("Running backup sync for failed webhooks");
            await webhookRetryService_js_1.default.backupSync();
            logger_1.default.info("Backup sync completed");
        }
        catch (error) {
            logger_1.default.error("Error running backup sync:", error);
        }
    }
    /**
     * Cleanup old failed webhooks (older than 30 days)
     */
    async cleanupOldFailedWebhooks() {
        try {
            logger_1.default.info("Cleaning up old failed webhooks");
            // Import prisma here to avoid circular dependencies
            const { prisma } = await import("../lib/prisma.js");
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 30);
            const result = await prisma.failedWebhook.deleteMany({
                where: {
                    created_at: {
                        lt: cutoffDate,
                    },
                },
            });
            logger_1.default.info(`Cleaned up ${result.count} old failed webhooks`);
        }
        catch (error) {
            logger_1.default.error("Error cleaning up old failed webhooks:", error);
        }
    }
    /**
     * Run backup sync manually (for testing or manual triggering)
     */
    async runBackupSyncManually() {
        await this.runBackupSync();
    }
    /**
     * Run cleanup manually (for testing or manual triggering)
     */
    async runCleanupManually() {
        await this.cleanupOldFailedWebhooks();
    }
}
exports.default = SchedulerService;
