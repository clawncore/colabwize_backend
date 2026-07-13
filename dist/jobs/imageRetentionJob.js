"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.imageRetentionJob = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const ImageUploadService_1 = require("../services/ImageUploadService");
const logger_1 = __importDefault(require("../monitoring/logger"));
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
exports.imageRetentionJob = {
    start: () => {
        logger_1.default.info("Initializing Image Retention Job (Daily at 2:00 AM)");
        // Run at 2:00 AM every day
        node_cron_1.default.schedule("0 2 * * *", async () => {
            logger_1.default.info("[Job] Starting Image Retention Cleanup");
            try {
                const deletedCount = await ImageUploadService_1.ImageUploadService.cleanupOldImages(90); // 90 days
                logger_1.default.info(`[Job] Image Retention Cleanup Completed. Deleted ${deletedCount} images.`);
            }
            catch (error) {
                logger_1.default.error(`[Job] Image Retention Cleanup Failed: ${error.message}`);
            }
        });
    }
};
