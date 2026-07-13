"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSearchAlertJobs = initializeSearchAlertJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const searchAlertService_1 = require("../services/searchAlertService");
const logger_1 = __importDefault(require("../monitoring/logger"));
/**
 * Initialize all search alert related cron jobs
 */
function initializeSearchAlertJobs() {
    // Search alert check job - runs every hour
    node_cron_1.default.schedule("0 * * * *", async () => {
        try {
            logger_1.default.info("Starting hourly search alert check job");
            await searchAlertService_1.SearchAlertService.runAutomatedChecks();
            logger_1.default.info("Search alert check job completed successfully");
        }
        catch (error) {
            logger_1.default.error("Error in search alert check job", {
                error: error.message,
            });
        }
    });
    logger_1.default.info("Search alert cron jobs initialized", {
        alertCheck: "Hourly (0 * * * *)",
    });
}
