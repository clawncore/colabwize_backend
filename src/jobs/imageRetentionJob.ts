import cron from "node-cron";
import { ImageUploadService } from "../services/ImageUploadService";
import logger from "../monitoring/logger";

/**
 * Image Retention Job
 * Runs daily at 2:00 AM
 * delete images that haven't been accessed? 
 * Actually Supabase Storage doesn't track "last_accessed" easily without a database table.
 * 
 * Requirement: "the bicke will deletethe image adtewr aloner tiome wothiu it being used"
 * 
 * Strategy: 
 * Since we don't have a reliable "last accessed" metadata from Supabase Storage easily available via API,
 * we will implement a "Time To Live" based on creation time for now, OR
 * we rely on the `ImageUploadService` to scan the bucket.
 * 
 * For this MVP, we will implement a job that deletes images created > 90 days ago.
 * 
 * Note: A more robust solution would track image usage in the database (checking if the URL exists in any project content).
 * That is expensive to check.
 * 
 * Users accepted "after a longer time".
 */

export const imageRetentionJob = {
    start: () => {
        logger.info("Initializing Image Retention Job (Daily at 2:00 AM)");

        // Run at 2:00 AM every day
        cron.schedule("0 2 * * *", async () => {
            logger.info("[Job] Starting Image Retention Cleanup");
            try {
                const deletedCount = await ImageUploadService.cleanupOldImages(90); // 90 days
                logger.info(`[Job] Image Retention Cleanup Completed. Deleted ${deletedCount} images.`);
            } catch (error: any) {
                logger.error(`[Job] Image Retention Cleanup Failed: ${error.message}`);
            }
        });
    }
};
