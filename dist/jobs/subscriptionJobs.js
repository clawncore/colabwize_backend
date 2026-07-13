"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeSubscriptionJobs = initializeSubscriptionJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const certificateRetentionService_1 = require("../services/certificateRetentionService");
const subscriptionService_1 = require("../services/subscriptionService");
const reconciliation_1 = require("../billing/reconciliation");
const logger_1 = __importDefault(require("../monitoring/logger"));
/**
 * Initialize all subscription-related cron jobs
 */
function initializeSubscriptionJobs() {
    // Certificate cleanup job - runs daily at midnight
    node_cron_1.default.schedule("0 0 * * *", async () => {
        try {
            logger_1.default.info("Starting daily certificate clup job");
            await certificateRetentionService_1.CertificateRetentionService.runCleanupJob();
            logger_1.default.info("Certificate cleanup job completed successfully");
        }
        catch (error) {
            logger_1.default.error("Error in certificate cleanup job", {
                error: error.message,
            });
        }
    });
    // Monthly usage reset job - runs on 1st of each month at midnight
    node_cron_1.default.schedule("0 0 1 * *", async () => {
        try {
            logger_1.default.info("Starting monthly usage reset job");
            await subscriptionService_1.SubscriptionService.resetMonthlyUsage();
            logger_1.default.info("Monthly usage reset job completed successfully");
        }
        catch (error) {
            logger_1.default.error("Error in monthly usage reset job", {
                error: error.message,
            });
        }
    });
    // Billing reconciliation job — runs nightly at 2 AM. Recomputes
    // userEntitlement from the UsageEvent ledger, releases stale HELD events,
    // and flags credit/entitlement mismatches.
    node_cron_1.default.schedule("0 2 * * *", async () => {
        try {
            logger_1.default.info("Starting nightly billing reconciliation job");
            const result = await reconciliation_1.ReconciliationService.runNightly();
            logger_1.default.info("Billing reconciliation job completed", {
                staleHeldReleased: result.staleHeldReleased,
                usersChecked: result.usersChecked,
                entitlementMismatches: result.entitlementMismatches,
                creditMismatches: result.creditMismatches,
                entitlementsRebuilt: result.entitlementsRebuilt,
                errors: result.errors.length,
            });
        }
        catch (error) {
            logger_1.default.error("Error in billing reconciliation job", {
                error: error.message,
            });
        }
    });
    logger_1.default.info("Subscription cron jobs initialized", {
        certificateCleanup: "Daily at midnight (0 0 * * *)",
        usageReset: "Monthly on 1st at midnight (0 0 1 * *)",
        billingReconciliation: "Nightly at 2 AM (0 2 * * *)",
    });
}
