import cron from "node-cron";
import { CertificateRetentionService } from "../services/certificateRetentionService";
import { SubscriptionService } from "../services/subscriptionService";
import { ReconciliationService } from "../billing/reconciliation";
import logger from "../monitoring/logger";

/**
 * Initialize all subscription-related cron jobs
 */
export function initializeSubscriptionJobs() {
  // Certificate cleanup job - runs daily at midnight
  cron.schedule("0 0 * * *", async () => {
    try {
      logger.info("Starting daily certificate clup job");
      await CertificateRetentionService.runCleanupJob();
      logger.info("Certificate cleanup job completed successfully");
    } catch (error: any) {
      logger.error("Error in certificate cleanup job", {
        error: error.message,
      });
    }
  });

  // Monthly usage reset job - runs on 1st of each month at midnight
  cron.schedule("0 0 1 * *", async () => {
    try {
      logger.info("Starting monthly usage reset job");
      await SubscriptionService.resetMonthlyUsage();
      logger.info("Monthly usage reset job completed successfully");
    } catch (error: any) {
      logger.error("Error in monthly usage reset job", {
        error: error.message,
      });
    }
  });

  // Billing reconciliation job — runs nightly at 2 AM. Recomputes
  // userEntitlement from the UsageEvent ledger, releases stale HELD events,
  // and flags credit/entitlement mismatches.
  cron.schedule("0 2 * * *", async () => {
    try {
      logger.info("Starting nightly billing reconciliation job");
      const result = await ReconciliationService.runNightly();
      logger.info("Billing reconciliation job completed", {
        staleHeldReleased: result.staleHeldReleased,
        usersChecked: result.usersChecked,
        entitlementMismatches: result.entitlementMismatches,
        creditMismatches: result.creditMismatches,
        entitlementsRebuilt: result.entitlementsRebuilt,
        errors: result.errors.length,
      });
    } catch (error: any) {
      logger.error("Error in billing reconciliation job", {
        error: error.message,
      });
    }
  });

  logger.info("Subscription cron jobs initialized", {
    certificateCleanup: "Daily at midnight (0 0 * * *)",
    usageReset: "Monthly on 1st at midnight (0 0 1 * *)",
    billingReconciliation: "Nightly at 2 AM (0 2 * * *)",
  });
}
