"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchAlertService = void 0;
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
const academicSearchService_1 = require("./academicSearchService");
const emailService_1 = require("./emailService");
class SearchAlertService {
    /**
     * Get all search alerts for a specific user
     */
    static async getAlerts(userId) {
        try {
            return await prisma_1.prisma.searchAlert.findMany({
                where: { user_id: userId },
                orderBy: { created_at: "desc" },
            });
        }
        catch (error) {
            logger_1.default.error("Error in SearchAlertService.getAlerts", { error: error.message, userId });
            throw error;
        }
    }
    /**
     * Create a new search alert
     */
    static async createAlert(userId, query, frequency) {
        try {
            return await prisma_1.prisma.searchAlert.create({
                data: {
                    user_id: userId,
                    query,
                    frequency,
                    is_active: true,
                    new_matches_count: 0,
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error in SearchAlertService.createAlert", { error: error.message, userId, query });
            throw error;
        }
    }
    /**
     * Update a search alert
     */
    static async updateAlert(userId, alertId, data) {
        try {
            return await prisma_1.prisma.searchAlert.update({
                where: {
                    id: alertId,
                    user_id: userId, // Ensure user owns the alert
                },
                data: {
                    ...data,
                    updated_at: new Date(),
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error in SearchAlertService.updateAlert", { error: error.message, alertId, userId });
            throw error;
        }
    }
    /**
     * Delete a search alert
     */
    static async deleteAlert(userId, alertId) {
        try {
            return await prisma_1.prisma.searchAlert.delete({
                where: {
                    id: alertId,
                    user_id: userId,
                },
            });
        }
        catch (error) {
            logger_1.default.error("Error in SearchAlertService.deleteAlert", { error: error.message, alertId, userId });
            throw error;
        }
    }
    /**
     * Manually check a search alert for new matches
     */
    static async checkAlert(userId, alertId) {
        try {
            const alert = await prisma_1.prisma.searchAlert.findUnique({
                where: {
                    id: alertId,
                    user_id: userId,
                },
            });
            if (!alert) {
                throw new Error("Search alert not found");
            }
            // Perform the actual search
            const results = await academicSearchService_1.AcademicSearchService.searchPapers(alert.query);
            // Update the alert's last checked timestamp and reset match count (since user just saw them)
            const updatedAlert = await prisma_1.prisma.searchAlert.update({
                where: { id: alertId },
                data: {
                    last_checked: new Date(),
                    new_matches_count: 0, // Reset counter since user is viewing matches
                },
            });
            return {
                alert: updatedAlert,
                results: results,
            };
        }
        catch (error) {
            logger_1.default.error("Error in SearchAlertService.checkAlert", { error: error.message, alertId, userId });
            throw error;
        }
    }
    /**
     * Run automated checks for all active alerts based on their frequency
     */
    static async runAutomatedChecks() {
        try {
            logger_1.default.info("Starting automated search alert checks");
            // Fetch active alerts with user info
            const alerts = await prisma_1.prisma.searchAlert.findMany({
                where: { is_active: true },
                include: {
                    user: {
                        select: {
                            email: true,
                            full_name: true,
                        },
                    },
                },
            });
            const now = new Date();
            let checkCount = 0;
            let notificationCount = 0;
            for (const alert of alerts) {
                // Determine if it's time to check based on frequency
                let shouldCheck = false;
                if (!alert.last_checked) {
                    shouldCheck = true;
                }
                else {
                    const lastChecked = new Date(alert.last_checked);
                    const hoursSinceLastCheck = (now.getTime() - lastChecked.getTime()) / (1000 * 60 * 60);
                    if (alert.frequency === "daily" && hoursSinceLastCheck >= 24)
                        shouldCheck = true;
                    else if (alert.frequency === "weekly" && hoursSinceLastCheck >= 168)
                        shouldCheck = true;
                    else if (alert.frequency === "monthly" && hoursSinceLastCheck >= 720)
                        shouldCheck = true;
                }
                if (shouldCheck) {
                    checkCount++;
                    try {
                        // Perform search
                        const results = await academicSearchService_1.AcademicSearchService.searchPapers(alert.query, 10);
                        const matchCount = results.length;
                        // Update alert status
                        await prisma_1.prisma.searchAlert.update({
                            where: { id: alert.id },
                            data: {
                                last_checked: now,
                                new_matches_count: matchCount,
                            },
                        });
                        // Notify user if matches found and they have an email
                        if (matchCount > 0 && alert.user?.email) {
                            notificationCount++;
                            await emailService_1.EmailService.sendSearchAlertEmail(alert.user.email, alert.user.full_name || "Researcher", alert.query, matchCount, results);
                        }
                    }
                    catch (err) {
                        logger_1.default.error(`Failed to check alert ${alert.id}`, { error: err.message });
                    }
                }
            }
            logger_1.default.info(`Completed automated search alert checks. Checked: ${checkCount}, Notified: ${notificationCount}`);
            return { checkCount, notificationCount };
        }
        catch (error) {
            logger_1.default.error("Error in SearchAlertService.runAutomatedChecks", { error: error.message });
            throw error;
        }
    }
}
exports.SearchAlertService = SearchAlertService;
