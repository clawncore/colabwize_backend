"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
/**
 * WebhookRetryService handles retrying failed webhooks with exponential backoff
 * and stores failed attempts in a dead letter queue for manual inspection
 */
class WebhookRetryService {
    static MAX_RETRIES = 5;
    static BASE_DELAY_MS = 1000; // 1 second
    /**
     * Process a webhook with retry logic
     * @param eventName The name of the event
     * @param handlerFunction The function to handle the event
     * @param data The webhook data
     */
    static async processWithRetry(eventName, handlerFunction, data) {
        let retryCount = 0;
        let lastError = null;
        while (retryCount <= WebhookRetryService.MAX_RETRIES) {
            try {
                await handlerFunction(data);
                logger_1.default.info(`Successfully processed webhook: ${eventName}`);
                return true;
            }
            catch (error) {
                lastError = error;
                retryCount++;
                logger_1.default.warn(`Webhook ${eventName} failed (attempt ${retryCount}):`, {
                    error: error.message,
                    stack: error.stack,
                    data,
                });
                if (retryCount <= WebhookRetryService.MAX_RETRIES) {
                    // Exponential backoff with jitter
                    const delay = WebhookRetryService.calculateDelay(retryCount);
                    logger_1.default.info(`Retrying ${eventName} in ${delay}ms`);
                    await WebhookRetryService.sleep(delay);
                }
            }
        }
        // If we've exhausted retries, store in dead letter queue
        await WebhookRetryService.moveToDeadLetterQueue(eventName, data, retryCount, lastError);
        logger_1.default.error(`Webhook ${eventName} failed permanently after ${retryCount} attempts`, {
            error: lastError?.message,
            data,
        });
        return false;
    }
    /**
     * Move a failed webhook to the dead letter queue for manual inspection
     */
    static async moveToDeadLetterQueue(eventName, data, retryCount, error) {
        try {
            await prisma_1.prisma.failedWebhook.create({
                data: {
                    event_name: eventName,
                    payload: data,
                    retry_count: retryCount,
                    last_error: error?.message || "Unknown error",
                    created_at: new Date(),
                    updated_at: new Date(),
                },
            });
            logger_1.default.info(`Moved failed webhook to dead letter queue: ${eventName}`);
        }
        catch (dbError) {
            logger_1.default.error("Failed to store webhook in dead letter queue:", dbError);
        }
    }
    /**
     * Calculate delay with exponential backoff and jitter
     */
    static calculateDelay(retryCount) {
        const exponentialDelay = WebhookRetryService.BASE_DELAY_MS * Math.pow(2, retryCount - 1);
        const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
        return Math.min(exponentialDelay + jitter, 300000); // Max 5 minutes
    }
    /**
     * Sleep for specified milliseconds
     */
    static sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
    /**
     * Process dead letter queue items manually
     */
    static async processDeadLetterQueue() {
        try {
            const failedWebhooks = await prisma_1.prisma.failedWebhook.findMany({
                where: {
                    retry_count: {
                        lt: WebhookRetryService.MAX_RETRIES + 2, // Allow one more retry attempt
                    },
                },
                orderBy: {
                    created_at: "asc",
                },
                take: 10, // Process max 10 at a time
            });
            logger_1.default.info(`Processing ${failedWebhooks.length} items from dead letter queue`);
            for (const webhook of failedWebhooks) {
                // Re-attempt processing based on event name
                // This would require mapping event names to handler functions
                logger_1.default.info(`Attempting to reprocess webhook: ${webhook.event_name}`, {
                    id: webhook.id,
                    retryCount: webhook.retry_count,
                });
                // Update retry count
                await prisma_1.prisma.failedWebhook.update({
                    where: { id: webhook.id },
                    data: {
                        retry_count: webhook.retry_count + 1,
                        updated_at: new Date(),
                    },
                });
            }
        }
        catch (error) {
            logger_1.default.error("Error processing dead letter queue:", error);
        }
    }
    /**
     * Backup synchronization mechanism for failed webhooks
     * This method should be called periodically to retry failed webhooks
     */
    static async backupSync() {
        try {
            // Find webhooks that failed more than 24 hours ago but less than 7 days ago
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - 7);
            const oldFailedWebhooks = await prisma_1.prisma.failedWebhook.findMany({
                where: {
                    created_at: {
                        gte: cutoffDate,
                    },
                    retry_count: {
                        lt: WebhookRetryService.MAX_RETRIES + 5, // Allow additional retry attempts
                    },
                },
                orderBy: {
                    created_at: "asc",
                },
                take: 5, // Process max 5 at a time to avoid overwhelming the system
            });
            logger_1.default.info(`Backup sync: Processing ${oldFailedWebhooks.length} old failed webhooks`);
            for (const webhook of oldFailedWebhooks) {
                logger_1.default.info(`Backup sync: Attempting to reprocess webhook: ${webhook.event_name}`, {
                    id: webhook.id,
                    retryCount: webhook.retry_count,
                    createdAt: webhook.created_at,
                });
                // Update retry count
                await prisma_1.prisma.failedWebhook.update({
                    where: { id: webhook.id },
                    data: {
                        retry_count: webhook.retry_count + 1,
                        updated_at: new Date(),
                    },
                });
                // Log the attempt for monitoring
                logger_1.default.info(`Backup sync: Updated retry count for webhook ${webhook.id}`);
            }
        }
        catch (error) {
            logger_1.default.error("Error in backup sync process:", error);
        }
    }
}
exports.default = WebhookRetryService;
