"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleTaskReminderTask = scheduleTaskReminderTask;
const TaskReminderService_1 = require("../services/TaskReminderService");
const logger_1 = __importDefault(require("../monitoring/logger"));
/**
 * Task to check for task due dates and send reminders.
 * Runs every 15 minutes by default.
 */
function scheduleTaskReminderTask() {
    try {
        logger_1.default.info("Initializing task reminder task...");
        // Run immediately on startup
        TaskReminderService_1.TaskReminderService.checkDueDates();
        // Schedule to run every 15 minutes
        setInterval(() => {
            logger_1.default.info("Running scheduled task reminder check...");
            TaskReminderService_1.TaskReminderService.checkDueDates();
        }, 15 * 60 * 1000);
        logger_1.default.info("Task reminder task scheduled successfully (15m interval)");
    }
    catch (error) {
        logger_1.default.error("Error starting task reminder task:", error);
    }
}
