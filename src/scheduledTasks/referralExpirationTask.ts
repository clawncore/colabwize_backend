import cron from "node-cron";
import { prisma } from "../lib/prisma";
import { EmailService } from "../services/emailService";
import logger from "../monitoring/logger";

/**
 * Daily cron job that:
 *   1. Sends an expiration reminder email to referees whose referral-granted
 *      Plus entitlement expires within the next 24 hours.
 *   2. Marks already-expired referral records with reward_status = "expired"
 *      so that audit queries and dashboards can distinguish active vs.
 *      past rewards without relying solely on lazy time comparisons.
 *
 * Runs at 09:00 UTC via node-cron (matching the convention in
 * backend/src/jobs/*.ts).
 */
async function checkExpiringReferrals() {
  logger.info("Starting referral expiration reminder check");

  try {
    const now = new Date();
    // 24-hour reminder window
    const windowEnd = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    // ── Phase 1: Expire stale referral records ──────────────────────────
    // Mark all granted referrals whose reward_expires_at has passed.
    // This is idempotent — re-running does nothing to already-expired rows.
    const expiryUpdate = await prisma.referral.updateMany({
      where: {
        reward_status: "granted",
        reward_expires_at: { lt: now },
      },
      data: { reward_status: "expired" },
    });
    if (expiryUpdate.count > 0) {
      logger.info(`Marked ${expiryUpdate.count} expired referral records`);
    }

    // ── Phase 2: Reminder emails for soon-to-expire rewards ─────────────
    const expiring = await prisma.referral.findMany({
      where: {
        reward_status: "granted",
        referee_reward_granted: true,
        referee_entitlement_expires: {
          gte: now,
          lt: windowEnd,
        },
        expiration_reminder_sent: false,
      },
      select: {
        id: true,
        referrer_id: true,
        referee_id: true,
        referee_entitlement_expires: true,
        referee: {
          select: {
            email: true,
            full_name: true,
          },
        },
      },
    });

    logger.info(`Found ${expiring.length} expiring referral rewards to remind`);

    for (const ref of expiring) {
      try {
        if (ref.referee?.email && ref.referee.full_name && ref.referee_entitlement_expires) {
          await EmailService.sendReferralExpirationReminder(
            ref.referee.email,
            ref.referee.full_name,
            ref.id,
            ref.referee_entitlement_expires,
          );
        }
        await prisma.referral.update({
          where: { id: ref.id },
          data: { expiration_reminder_sent: true },
        });
      } catch (err: any) {
        // Log but continue — don't let one failure stop the batch
        logger.warn("Failed to send referral expiration reminder", {
          referralId: ref.id,
          refereeId: ref.referee_id,
          error: err.message,
        });
      }
    }

    logger.info("Completed referral expiration reminder check");
  } catch (error: any) {
    logger.error("Error in referral expiration task", { error: error.message });
  }
}

/**
 * Register the referral expiration reminder cron job.
 * Runs daily at 09:00 UTC.
 */
export function scheduleReferralExpirationTask() {
  // Run daily at 09:00 UTC
  cron.schedule("0 9 * * *", async () => {
    await checkExpiringReferrals();
  });

  logger.info("Scheduled referral expiration task: daily at 09:00 UTC");
}
