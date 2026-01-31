import cron from "node-cron";
import { SearchAlertService } from "../services/searchAlertService";
import logger from "../monitoring/logger";

/**
 * Initialize all search alert related cron jobs
 */
export function initializeSearchAlertJobs() {
    // Search alert check job - runs every hour
    cron.schedule("0 * * * *", async () => {
        try {
            logger.info("Starting hourly search alert check job");
            await SearchAlertService.runAutomatedChecks();
            logger.info("Search alert check job completed successfully");
        } catch (error: any) {
            logger.error("Error in search alert check job", {
                error: error.message,
            });
        }
    });

    logger.info("Search alert cron jobs initialized", {
        alertCheck: "Hourly (0 * * * *)",
    });
}
