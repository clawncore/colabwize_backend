"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
const editorService_1 = require("./editorService");
// Version Scheduler Service
class VersionSchedulerService {
    static instance;
    intervalId = null;
    CHECK_INTERVAL = 60 * 1000; // Check every minute
    constructor() { }
    static getInstance() {
        if (!VersionSchedulerService.instance) {
            VersionSchedulerService.instance = new VersionSchedulerService();
        }
        return VersionSchedulerService.instance;
    }
    // Start the scheduler
    start() {
        if (this.intervalId) {
            logger_1.default.info("Version scheduler is already running");
            return;
        }
        logger_1.default.info("Starting version scheduler");
        this.intervalId = setInterval(() => {
            this.processScheduledVersions().catch((error) => {
                logger_1.default.error("Error processing scheduled versions:", error);
            });
        }, this.CHECK_INTERVAL);
    }
    // Stop the scheduler
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            logger_1.default.info("Stopped version scheduler");
        }
    }
    // Process scheduled versions that are due
    async processScheduledVersions() {
        try {
            const now = new Date();
            // Find all enabled schedules that are due
            const dueSchedules = await prisma_1.prisma.versionSchedule.findMany({
                where: {
                    enabled: true,
                    next_run: {
                        lte: now,
                    },
                },
                include: {
                    project: {
                        include: {
                            user: true,
                        },
                    },
                },
            });
            if (dueSchedules.length === 0) {
                return;
            }
            logger_1.default.info(`Processing ${dueSchedules.length} scheduled versions`);
            // Process each due schedule
            for (const schedule of dueSchedules) {
                try {
                    await this.processSchedule(schedule);
                }
                catch (error) {
                    logger_1.default.error(`Error processing schedule ${schedule.id}:`, error);
                }
            }
            // Process default (30-min) schedules for projects without explicit settings
            await this.processDefaultSchedules();
        }
        catch (error) {
            logger_1.default.error("Error in processScheduledVersions:", error);
        }
    }
    // Process default 30-minute versioning for projects without explicit schedules
    async processDefaultSchedules() {
        try {
            const now = new Date();
            // Find projects updated in the last 12 hours that don't have explicit schedules
            const activeThreshold = new Date(now.getTime() - 12 * 60 * 60 * 1000);
            const projectsToProcess = await prisma_1.prisma.project.findMany({
                where: {
                    updated_at: {
                        gte: activeThreshold,
                    },
                    version_schedules: {
                        none: {}, // No explicit schedules set
                    },
                },
                include: {
                    document_versions: {
                        orderBy: {
                            created_at: "desc",
                        },
                        take: 1,
                    },
                },
            });
            if (projectsToProcess.length === 0) {
                return;
            }
            logger_1.default.info(`Checking default 1-hr versioning for ${projectsToProcess.length} active projects`);
            for (const project of projectsToProcess) {
                try {
                    const lastVersion = project.document_versions[0];
                    const lastVersionAt = lastVersion
                        ? new Date(lastVersion.created_at)
                        : null;
                    // Initial quick checks to avoid calling EditorService.shouldCreateNewVersion unnecessarily
                    const hasChanges = !lastVersionAt || new Date(project.updated_at) > lastVersionAt;
                    const isTimeDue = !lastVersionAt ||
                        now.getTime() - lastVersionAt.getTime() >= 60 * 60 * 1000;
                    if (!hasChanges || !isTimeDue) {
                        continue;
                    }
                    // Double check with shouldCreateNewVersion (which does deeper content analysis)
                    const shouldCreate = await editorService_1.EditorService.shouldCreateNewVersion(project.id, null, project.word_count, project.content);
                    if (shouldCreate) {
                        logger_1.default.info(`Creating default 1-hr version for project ${project.id}`);
                        await editorService_1.EditorService.createDocumentVersion(project.id, project.user_id, project.content || {}, project.word_count || 0);
                    }
                }
                catch (error) {
                    logger_1.default.error(`Error processing default versioning for project ${project.id}:`, error);
                }
            }
        }
        catch (error) {
            logger_1.default.error("Error in processDefaultSchedules:", error);
        }
    }
    // Process a single schedule
    async processSchedule(schedule) {
        try {
            logger_1.default.info(`Processing version schedule ${schedule.id} for project ${schedule.project_id}`);
            // Get the current project content
            const project = await prisma_1.prisma.project.findUnique({
                where: {
                    id: schedule.project_id,
                },
                select: {
                    content: true,
                    word_count: true,
                },
            });
            if (!project) {
                throw new Error(`Project ${schedule.project_id} not found`);
            }
            // Create a document version with actual project content
            await editorService_1.EditorService.createDocumentVersion(schedule.project_id, schedule.project.user_id, project.content || {}, project.word_count || 0);
            // Update the next run time based on frequency
            const nextRunTime = this.calculateNextRunTime(new Date(), schedule.frequency);
            await prisma_1.prisma.versionSchedule.update({
                where: {
                    id: schedule.id,
                },
                data: {
                    next_run: nextRunTime,
                },
            });
            logger_1.default.info(`Successfully processed version schedule ${schedule.id}`);
        }
        catch (error) {
            logger_1.default.error(`Error processing schedule ${schedule.id}:`, error);
            throw error;
        }
    }
    // Calculate next run time based on frequency
    calculateNextRunTime(currentTime, frequency) {
        const nextRunTime = new Date(currentTime);
        switch (frequency) {
            case "30min":
                nextRunTime.setMinutes(nextRunTime.getMinutes() + 30);
                break;
            case "hourly":
                nextRunTime.setHours(nextRunTime.getHours() + 1);
                break;
            case "daily":
                nextRunTime.setDate(nextRunTime.getDate() + 1);
                break;
            case "weekly":
                nextRunTime.setDate(nextRunTime.getDate() + 7);
                break;
            case "monthly":
                nextRunTime.setMonth(nextRunTime.getMonth() + 1);
                break;
            default:
                // Default to daily
                nextRunTime.setDate(nextRunTime.getDate() + 1);
        }
        return nextRunTime;
    }
}
exports.default = VersionSchedulerService.getInstance();
