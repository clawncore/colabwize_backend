import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { SubscriptionService } from "./subscriptionService";

/**
 * Certificate Retention Service
 * Handles automatic deletion of old certificates based on plan limits
 */
export class CertificateRetentionService {
  /**
   * Clean up expired certificates for a user based on their plan
   */
  static async cleanupExpiredCertificates(userId: string): Promise<number> {
    try {
      const plan = await SubscriptionService.getActivePlan(userId);
      const limits = SubscriptionService.getPlanLimits(plan);
      const retentionDays = limits.certificate_retention_days;

      // -1 = unlimited retention
      if (retentionDays === -1) {
        logger.debug("Unlimited retention for user", { userId, plan });
        return 0;
      }

      // 0 = no retention (delete immediately after download/creation)
      if (retentionDays === 0) {
        const deleted = await prisma.certificate.deleteMany({
          where: {
            user_id: userId,
            created_at: {
              lt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Older than 1 day
            },
          },
        });

        logger.info("Deleted pay-as-you-go certificates", {
          userId,
          count: deleted.count,
        });
        return deleted.count;
      }

      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      // Delete certificates older than retention period
      const deleted = await prisma.certificate.deleteMany({
        where: {
          user_id: userId,
          created_at: {
            lt: cutoffDate,
          },
        },
      });

      if (deleted.count > 0) {
        logger.info("Cleaned up expired certificates", {
          userId,
          plan,
          retentionDays,
          deletedCount: deleted.count,
        });
      }

      return deleted.count;
    } catch (error: any) {
      logger.error("Error cleaning up certificates", {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Run cleanup job for all users (called by cron)
   */
  static async runCleanupJob(): Promise<void> {
    try {
      logger.info("Starting certificate cleanup job");

      const users = await prisma.user.findMany({
        select: { id: true },
      });

      let totalDeleted = 0;
      for (const user of users) {
        const deleted = await this.cleanupExpiredCertificates(user.id);
        totalDeleted += deleted;
      }

      logger.info("Certificate cleanup job completed", {
        usersProcessed: users.length,
        certificatesDeleted: totalDeleted,
      });
    } catch (error: any) {
      logger.error("Error in certificate cleanup job", {
        error: error.message,
      });
    }
  }

  /**
   * Get certificate retention status for a user
   */
  static async getRetentionInfo(userId: string) {
    const plan = await SubscriptionService.getActivePlan(userId);
    const limits = SubscriptionService.getPlanLimits(plan);
    const retentionDays = limits.certificate_retention_days;

    const certificates = await prisma.certificate.findMany({
      where: { user_id: userId },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        created_at: true,
        title: true,
      },
    });

    let status = "unlimited";
    if (retentionDays === 0) status = "immediate_deletion";
    else if (retentionDays > 0) status = `${retentionDays}_days`;

    return {
      plan,
      retention_days: retentionDays,
      retention_status: status,
      total_certificates: certificates.length,
      certificates: certificates.map((cert: any) => ({
        id: cert.id,
        title: cert.title,
        created_at: cert.created_at,
        expires_at:
          retentionDays > 0
            ? new Date(
                cert.created_at.getTime() + retentionDays * 24 * 60 * 60 * 1000
              )
            : retentionDays === 0
            ? new Date(cert.created_at.getTime() + 24 * 60 * 60 * 1000)
            : null,
      })),
    };
  }
}
