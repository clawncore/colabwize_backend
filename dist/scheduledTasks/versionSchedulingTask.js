"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleVersionSchedulingTask = scheduleVersionSchedulingTask;
const versionSchedulerService_1 = __importDefault(require("../services/versionSchedulerService"));
const logger_1 = __importDefault(require("../monitoring/logger"));
/**
 * Task to initialize and start the version scheduler
 * This checks for due version schedules every minute
 */
function scheduleVersionSchedulingTask() {
    try {
        logger_1.default.info("Initializing version scheduling task...");
        // Start the scheduler service
        // It has its own internal interval of 60 seconds
        versionSchedulerService_1.default.start();
        logger_1.default.info("Version scheduling task started successfully");
    }
    catch (error) {
        logger_1.default.error("Error starting version scheduling task:", error);
    }
}
