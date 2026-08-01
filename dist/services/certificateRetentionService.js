"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CertificateRetentionService = void 0;
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
const subscriptionService_1 = require("./subscriptionService");
/**
 * Certificate Retention Service
 * Handles automatic deletion of old certificates based on plan limits
 */
class CertificateRetentionService {
    /**
     * Clean up expired certificates for a user based on their plan
     */
    static async cleanupExpiredCertificates(userId) {
        try {
            const plan = await subscriptionService_1.SubscriptionService.getActivePlan(userId);
            const limits = subscriptionService_1.SubscriptionService.getPlanLimits(plan);
            const retentionDays = limits.certificate_retention_days;
            // -1 = unlimited retention
            if (retentionDays === -1) {
                logger_1.default.debug("Unlimited retention for user", { userId, plan });
                return 0;
            }
            // 0 = no retention (delete immediately after download/creation)
            if (retentionDays === 0) {
                const deleted = await prisma_1.prisma.certificate.deleteMany({
                    where: {
                        user_id: userId,
                        created_at: {
                            lt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Older than 1 day
                        },
                    },
                });
                logger_1.default.info("Deleted pay-as-you-go certificates", {
                    userId,
                    count: deleted.count,
                });
                return deleted.count;
            }
            // Calculate cutoff date
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            // Delete certificates older than retention period
            const deleted = await prisma_1.prisma.certificate.deleteMany({
                where: {
                    user_id: userId,
                    created_at: {
                        lt: cutoffDate,
                    },
                },
            });
            if (deleted.count > 0) {
                logger_1.default.info("Cleaned up expired certificates", {
                    userId,
                    plan,
                    retentionDays,
                    deletedCount: deleted.count,
                });
            }
            return deleted.count;
        }
        catch (error) {
            logger_1.default.error("Error cleaning up certificates", {
                userId,
                error: error.message,
            });
            throw error;
        }
    }
    /**
     * Run cleanup job for all users (called by cron)
     */
    static async runCleanupJob() {
        try {
            logger_1.default.info("Starting certificate cleanup job");
            const users = await prisma_1.prisma.user.findMany({
                select: { id: true },
            });
            let totalDeleted = 0;
            for (const user of users) {
                const deleted = await this.cleanupExpiredCertificates(user.id);
                totalDeleted += deleted;
            }
            logger_1.default.info("Certificate cleanup job completed", {
                usersProcessed: users.length,
                certificatesDeleted: totalDeleted,
            });
        }
        catch (error) {
            logger_1.default.error("Error in certificate cleanup job", {
                error: error.message,
            });
        }
    }
    /**
     * Get certificate retention status for a user
     */
    static async getRetentionInfo(userId) {
        const plan = await subscriptionService_1.SubscriptionService.getActivePlan(userId);
        const limits = subscriptionService_1.SubscriptionService.getPlanLimits(plan);
        const retentionDays = limits.certificate_retention_days;
        const certificates = await prisma_1.prisma.certificate.findMany({
            where: { user_id: userId },
            orderBy: { created_at: "desc" },
            select: {
                id: true,
                created_at: true,
                title: true,
            },
        });
        let status = "unlimited";
        if (retentionDays === 0)
            status = "immediate_deletion";
        else if (retentionDays > 0)
            status = `${retentionDays}_days`;
        return {
            plan,
            retention_days: retentionDays,
            retention_status: status,
            total_certificates: certificates.length,
            certificates: certificates.map((cert) => ({
                id: cert.id,
                title: cert.title,
                created_at: cert.created_at,
                expires_at: retentionDays > 0
                    ? new Date(cert.created_at.getTime() + retentionDays * 24 * 60 * 60 * 1000)
                    : retentionDays === 0
                        ? new Date(cert.created_at.getTime() + 24 * 60 * 60 * 1000)
                        : null,
            })),
        };
    }
}
exports.CertificateRetentionService = CertificateRetentionService;
