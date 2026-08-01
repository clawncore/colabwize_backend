"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startRecurringTaskGeneration = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = __importDefault(require("../monitoring/logger"));
const RecurringTaskService_1 = __importDefault(require("../services/RecurringTaskService"));
/**
 * Scheduled task to generate recurring task instances
 * Runs daily at 2 AM
 */
const startRecurringTaskGeneration = () => {
    // Run daily at 2:00 AM
    node_cron_1.default.schedule("0 2 * * *", async () => {
        logger_1.default.info("Starting recurring task instance generation...");
        try {
            // Get all workspaces with active recurring tasks
            const workspaces = await prisma_1.default.workspace.findMany({
                where: {
                    tasks: {
                        some: {
                            is_recurring: true,
                            parent_recurring_task_id: null, // Only parent tasks
                        },
                    },
                },
                select: { id: true, name: true },
            });
            logger_1.default.info(`Found ${workspaces.length} workspaces with recurring tasks`);
            let totalInstancesCreated = 0;
            for (const workspace of workspaces) {
                try {
                    const results = await RecurringTaskService_1.default.generateInstancesForWorkspace(workspace.id, 2);
                    const instancesCreated = results.reduce((sum, r) => sum + (r.instancesCreated || 0), 0);
                    totalInstancesCreated += instancesCreated;
                    logger_1.default.info(`Workspace "${workspace.name}": Generated ${instancesCreated} task instances`);
                }
                catch (err) {
                    logger_1.default.error(`Failed to generate instances for workspace ${workspace.id}:`, err);
                }
            }
            logger_1.default.info(`Recurring task generation complete. Total instances created: ${totalInstancesCreated}`);
            // Clean up old completed instances (older than 90 days)
            try {
                const cleanedCount = await RecurringTaskService_1.default.cleanupOldInstances(90);
                logger_1.default.info(`Cleaned up ${cleanedCount} old completed task instances`);
            }
            catch (err) {
                logger_1.default.error("Failed to clean up old instances:", err);
            }
        }
        catch (error) {
            logger_1.default.error("Error in recurring task generation job:", error);
        }
    });
    logger_1.default.info("Recurring task generation scheduler started (runs daily at 2 AM)");
};
exports.startRecurringTaskGeneration = startRecurringTaskGeneration;
