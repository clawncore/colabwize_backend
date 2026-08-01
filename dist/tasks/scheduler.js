"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const updateLeaderboard_1 = require("./updateLeaderboard");
const logger_1 = __importDefault(require("../monitoring/logger"));
const webhookRetryService_1 = __importDefault(require("../services/webhookRetryService"));
// Simple in-memory scheduler
class TaskScheduler {
    static instance;
    tasks = new Map();
    constructor() { }
    static getInstance() {
        if (!TaskScheduler.instance) {
            TaskScheduler.instance = new TaskScheduler();
        }
        return TaskScheduler.instance;
    }
    // Schedule a task to run at a specific interval
    scheduleTask(name, task, intervalMs) {
        // Clear existing task if it exists
        if (this.tasks.has(name)) {
            clearInterval(this.tasks.get(name));
        }
        // Schedule the task
        const intervalId = setInterval(async () => {
            try {
                logger_1.default.info(`Running scheduled task: ${name}`);
                await task();
            }
            catch (error) {
                logger_1.default.error(`Error in scheduled task ${name}:`, error);
            }
        }, intervalMs);
        // Store the interval ID
        this.tasks.set(name, intervalId);
        logger_1.default.info(`Scheduled task ${name} to run every ${intervalMs}ms`);
    }
    // Stop a scheduled task
    stopTask(name) {
        if (this.tasks.has(name)) {
            clearInterval(this.tasks.get(name));
            this.tasks.delete(name);
            logger_1.default.info(`Stopped scheduled task: ${name}`);
        }
    }
    // Stop all scheduled tasks
    stopAllTasks() {
        for (const [name, intervalId] of this.tasks.entries()) {
            clearInterval(intervalId);
            logger_1.default.info(`Stopped scheduled task: ${name}`);
        }
        this.tasks.clear();
    }
}
// Initialize the scheduler
const scheduler = TaskScheduler.getInstance();
// Schedule leaderboard updates every hour
scheduler.scheduleTask("updateLeaderboards", updateLeaderboard_1.updateAllLeaderboards, 60 * 60 * 1000); // 1 hour
// Schedule backup sync for failed webhooks every hour
scheduler.scheduleTask("backupSyncFailedWebhooks", () => webhookRetryService_1.default.backupSync(), 60 * 60 * 1000); // 1 hour
// Export for use in other modules
exports.default = scheduler;
