"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleSearchAlertsTask = scheduleSearchAlertsTask;
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
const paperDiscoveryService_1 = require("../services/paperDiscoveryService");
const emailService_1 = require("../services/emailService");
/**
 * Checks all active search alerts for new papers
 * This is designed to run periodically (e.g., daily)
 */
async function checkSearchAlerts() {
    logger_1.default.info("Starting scheduled search alerts check...");
    try {
        // 1. Get all active alerts
        const alerts = await prisma_1.prisma.searchAlert.findMany({
            where: { is_active: true },
            include: { user: true },
        });
        logger_1.default.info(`Found ${alerts.length} active alerts to check.`);
        for (const alert of alerts) {
            try {
                // Skip if not due (simple logic: check daily)
                // In a real app, we'd check `last_checked` vs `frequency`
                // For now, we assume this task runs daily and checks everything appropriate
                // (Improving logic: if frequency=weekly, only check if > 7 days since last_checked)
                const now = new Date();
                const lastChecked = new Date(alert.last_checked);
                const daysSinceCheck = (now.getTime() - lastChecked.getTime()) / (1000 * 3600 * 24);
                // Basic frequency gates
                if (alert.frequency === "weekly" && daysSinceCheck < 7)
                    continue;
                if (alert.frequency === "monthly" && daysSinceCheck < 30)
                    continue;
                // daily is always checked if task runs daily
                logger_1.default.info(`Checking alert "${alert.query}" for user ${alert.user.email}`);
                // 2. Perform Search (fetch recent only)
                // We look for papers published in the last X period or simply fetch top new results
                // Since `searchPapers` returns relevancy-sorted, we hope for recent ones.
                // A better search API would support "published_after" param.
                // PaperDiscoveryService currently doesn't expose date filtering explicitly in args,
                // but we can filter results manually if needed.
                const results = await paperDiscoveryService_1.PaperDiscoveryService.searchPapers(alert.query, 0, 10);
                // 3. Filter for "New" (simulated for now)
                // In a real system, we'd compare paper IDs against a "SentAlerts" history table.
                // Here, we'll assume any result is "new" if we haven't checked in a while,
                // OR we can just pick the top 3 and send them as "Top picks for you".
                if (results.length > 0) {
                    // Update the alert stats
                    await prisma_1.prisma.searchAlert.update({
                        where: { id: alert.id },
                        data: {
                            last_checked: new Date(),
                            new_matches_count: results.length,
                        },
                    });
                    // 4. Send Email
                    if (alert.user.email) {
                        await emailService_1.EmailService.sendSearchAlertEmail(alert.user.email, alert.user.full_name || "Researcher", alert.query, results.length, // Number of matches
                        results.slice(0, 5) // Top 5
                        );
                    }
                }
            }
            catch (err) {
                logger_1.default.error(`Failed to process alert ${alert.id}`, err);
                // Continue to next alert
            }
        }
        logger_1.default.info("Completed search alerts check.");
    }
    catch (error) {
        logger_1.default.error("Error in checkSearchAlerts task:", error);
    }
}
// Scheduler wrapper similar to cleanupExpiredItems
function scheduleSearchAlertsTask() {
    // Run once on startup for testing (optional, maybe too noisy for dev?)
    // setTimeout(checkSearchAlerts, 10000); // Run 10s after startup
    // Run daily at 8 AM
    const now = new Date();
    const nextRun = new Date();
    nextRun.setHours(8, 0, 0, 0);
    if (nextRun <= now) {
        nextRun.setDate(nextRun.getDate() + 1);
    }
    const timeUntilNextRun = nextRun.getTime() - now.getTime();
    setTimeout(() => {
        checkSearchAlerts();
        setInterval(checkSearchAlerts, 24 * 60 * 60 * 1000);
    }, timeUntilNextRun);
    logger_1.default.info(`Scheduled search alerts check daily at 08:00`);
}
