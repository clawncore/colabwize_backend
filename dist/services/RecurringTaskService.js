"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecurringTaskService = void 0;
const rrule_1 = require("rrule");
const prisma_1 = __importDefault(require("../lib/prisma"));
const logger_1 = __importDefault(require("../monitoring/logger"));
const notificationServer_1 = require("../lib/notificationServer");
class RecurringTaskService {
    /**
     * Convert simple pattern to RRULE string
     */
    static patternToRRule(pattern, startDate, config) {
        const interval = config?.interval || 1;
        switch (pattern.toLowerCase()) {
            case "daily":
                return new rrule_1.RRule({
                    freq: rrule_1.RRule.DAILY,
                    interval,
                    dtstart: startDate,
                    until: config?.endDate,
                    count: config?.maxOccurrences,
                }).toString();
            case "weekly":
                return new rrule_1.RRule({
                    freq: rrule_1.RRule.WEEKLY,
                    interval,
                    byweekday: config?.daysOfWeek || [startDate.getDay()],
                    dtstart: startDate,
                    until: config?.endDate,
                    count: config?.maxOccurrences,
                }).toString();
            case "monthly":
                return new rrule_1.RRule({
                    freq: rrule_1.RRule.MONTHLY,
                    interval,
                    bymonthday: config?.dayOfMonth || startDate.getDate(),
                    dtstart: startDate,
                    until: config?.endDate,
                    count: config?.maxOccurrences,
                }).toString();
            case "yearly":
                return new rrule_1.RRule({
                    freq: rrule_1.RRule.YEARLY,
                    interval,
                    dtstart: startDate,
                    until: config?.endDate,
                    count: config?.maxOccurrences,
                }).toString();
            default:
                // Assume it's already an RRULE string
                return pattern;
        }
    }
    /**
     * Validate RRULE pattern
     */
    static validateRRule(rruleString) {
        try {
            (0, rrule_1.rrulestr)(rruleString);
            return true;
        }
        catch (error) {
            logger_1.default.error("Invalid RRULE pattern:", error);
            return false;
        }
    }
    /**
     * Get next N occurrences from a recurrence pattern
     */
    static getNextOccurrences(rruleString, startDate, count = 10) {
        try {
            const rule = (0, rrule_1.rrulestr)(rruleString);
            return rule.all((date, i) => i < count);
        }
        catch (error) {
            logger_1.default.error("Error generating occurrences:", error);
            return [];
        }
    }
    /**
     * Get occurrences within a date range
     */
    static getOccurrencesInRange(rruleString, startDate, endDate) {
        try {
            const rule = (0, rrule_1.rrulestr)(rruleString);
            return rule.between(startDate, endDate, true);
        }
        catch (error) {
            logger_1.default.error("Error generating occurrences in range:", error);
            return [];
        }
    }
    /**
     * Generate task instances for a recurring task
     * @param parentTaskId - The ID of the parent recurring task
     * @param weeksAhead - How many weeks in the future to generate instances (default: 2)
     */
    static async generateTaskInstances(parentTaskId, weeksAhead = 2) {
        try {
            // Get the parent recurring task
            const parentTask = await prisma_1.default.workspaceTask.findUnique({
                where: { id: parentTaskId },
                include: {
                    assignees: true,
                    labels: true,
                },
            });
            if (!parentTask ||
                !parentTask.is_recurring ||
                !parentTask.recurrence_pattern) {
                throw new Error("Task is not a valid recurring task");
            }
            if (!parentTask.due_date) {
                throw new Error("Recurring task must have a start due date");
            }
            // Calculate the range for generating instances
            // We start from the task's due date to ensure we don't miss the first occurrence
            // even if the time has passed for today.
            const now = new Date();
            const startDate = parentTask.due_date && parentTask.due_date < now ? parentTask.due_date : now;
            const futureDate = new Date();
            futureDate.setDate(futureDate.getDate() + weeksAhead * 7);
            // Get existing instances to avoid duplicates
            const existingInstances = await prisma_1.default.workspaceTask.findMany({
                where: {
                    parent_recurring_task_id: parentTaskId,
                    due_date: {
                        gte: now,
                        lte: futureDate,
                    },
                },
                select: { due_date: true },
            });
            const existingDueDates = new Set(existingInstances
                .map((i) => i.due_date?.toISOString())
                .filter((d) => d !== null && d !== undefined));
            // Generate occurrences using RRULE
            const occurrences = this.getOccurrencesInRange(parentTask.recurrence_pattern, startDate, futureDate);
            // Create task instances for each occurrence
            const createdInstances = [];
            for (const occurrenceDate of occurrences) {
                // Skip if instance already exists
                if (existingDueDates.has(occurrenceDate.toISOString())) {
                    continue;
                }
                // Create the task instance
                const instance = await prisma_1.default.workspaceTask.create({
                    data: {
                        workspace_id: parentTask.workspace_id,
                        creator_id: parentTask.creator_id,
                        title: parentTask.title,
                        description: parentTask.description,
                        status: "todo",
                        priority: parentTask.priority,
                        due_date: occurrenceDate,
                        parent_recurring_task_id: parentTaskId,
                        is_recurring: false,
                        original_due_date: occurrenceDate,
                        assignees: {
                            create: parentTask.assignees.map((a) => ({
                                user_id: a.user_id,
                            })),
                        },
                        labels: {
                            connect: parentTask.labels.map((l) => ({
                                id: l.id,
                            })),
                        },
                    },
                    include: {
                        assignees: {
                            include: {
                                user: {
                                    select: { id: true, full_name: true, email: true },
                                },
                            },
                        },
                        labels: true,
                    },
                });
                // Broadcast the new instance to the workspace channel
                try {
                    const notificationServer = (0, notificationServer_1.getNotificationServer)();
                    notificationServer.broadcastToChannel(`workspace:${parentTask.workspace_id}`, {
                        type: "TASK_CREATED",
                        task: instance,
                    });
                }
                catch (eventError) {
                    logger_1.default.error("Failed to broadcast recurring task instance creation:", eventError);
                }
                createdInstances.push(instance);
            }
            logger_1.default.info(`Generated ${createdInstances.length} instances for recurring task ${parentTaskId}`);
            return createdInstances;
        }
        catch (error) {
            logger_1.default.error("Error generating task instances:", error);
            throw error;
        }
    }
    /**
     * Generate instances for all active recurring tasks in a workspace
     */
    static async generateInstancesForWorkspace(workspaceId, weeksAhead = 2) {
        try {
            // Get all active recurring tasks (parent tasks only)
            const recurringTasks = await prisma_1.default.workspaceTask.findMany({
                where: {
                    workspace_id: workspaceId,
                    is_recurring: true,
                    parent_recurring_task_id: null, // Only parent tasks
                },
            });
            const results = [];
            for (const task of recurringTasks) {
                try {
                    const instances = await this.generateTaskInstances(task.id, weeksAhead);
                    results.push({ taskId: task.id, instancesCreated: instances.length });
                }
                catch (err) {
                    logger_1.default.error(`Failed to generate instances for task ${task.id}:`, err);
                    results.push({ taskId: task.id, error: err });
                }
            }
            return results;
        }
        catch (error) {
            logger_1.default.error("Error generating instances for workspace:", error);
            throw error;
        }
    }
    /**
     * Clean up old completed recurring task instances
     * @param daysOld - Delete completed instances older than this many days
     */
    static async cleanupOldInstances(daysOld = 90) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);
            const result = await prisma_1.default.workspaceTask.deleteMany({
                where: {
                    parent_recurring_task_id: { not: null }, // Only instances
                    status: "done",
                    updated_at: { lt: cutoffDate },
                },
            });
            logger_1.default.info(`Cleaned up ${result.count} old recurring task instances`);
            return result.count;
        }
        catch (error) {
            logger_1.default.error("Error cleaning up old instances:", error);
            throw error;
        }
    }
    /**
     * Get human-readable description of recurrence pattern
     */
    static getRecurrenceDescription(rruleString) {
        try {
            const rule = (0, rrule_1.rrulestr)(rruleString);
            return rule.toText();
        }
        catch (error) {
            return "Custom recurrence pattern";
        }
    }
}
exports.RecurringTaskService = RecurringTaskService;
exports.default = RecurringTaskService;
