"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleInboxWorkerTask = void 0;
const inboxFetcher_1 = require("../services/email/inboxFetcher");
const logger_1 = __importDefault(require("../monitoring/logger"));
let checkInterval;
const scheduleInboxWorkerTask = () => {
    // Prevent duplicate execution intervals if called multiple times natively
    if (checkInterval)
        return;
    // Initial immediate run
    setTimeout(() => {
        executeTask();
    }, 5000); // 5 second startup delay for DB to warm up
    // 60-second polling interval
    checkInterval = setInterval(async () => {
        await executeTask();
    }, 1000 * 60);
    logger_1.default.info("Inbox Worker task scheduled to run every 60 seconds.");
};
exports.scheduleInboxWorkerTask = scheduleInboxWorkerTask;
const executeTask = async () => {
    try {
        await (0, inboxFetcher_1.processIncomingSupportEmails)();
    }
    catch (error) {
        logger_1.default.error("Failed to execute background Support Inbox worker task", error);
    }
};
