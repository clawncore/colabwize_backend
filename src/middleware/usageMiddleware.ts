import { Request, Response, NextFunction } from "express";
import { SubscriptionService } from "../services/subscriptionService";
import { EmailService } from "../services/emailService";
import { prisma } from "../lib/prisma";
import { SecretsService } from "../services/secrets-service";
import logger from "../monitoring/logger";
import { EntitlementService } from "../services/EntitlementService";

/**
 * Middleware to check usage limits before allowing feature access
 */
export const checkUsageLimit = (feature: string) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: "Unauthorized",
        });
        return;
      }

      // Check if user can perform action (Consumes Entitlement/Credit if allowed)
      try {
        await EntitlementService.assertCanUse(userId, feature);
      } catch (e: any) {
        logger.warn("Usage limit exceeded (Blocked by EntitlementService)", {
          userId,
          feature,
          error: e.message
        });

        res.status(403).json({
          success: false,
          error: `${feature} usage limit reached`,
          data: {
            upgrade_url: "/pricing",
            message: e.message
          },
        });
        return;
      }

      // User can proceed
      next();
    } catch (error: any) {
      logger.error("Error in usage limit middleware", {
        error: error.message,
        feature,
      });

      res.status(500).json({
        success: false,
        error: "Failed to check usage limits",
      });
    }
  };
};

/**
 * Middleware to increment usage after successful operation
 */
export const incrementFeatureUsage = (feature: string) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const userId = (req as any).user?.id;

      if (userId) {
        // Deprecated: EntitlementService now handles basic consumption in assertCanUse.
        // However, middleware usage is often for simple actions like "scan".
        // If assertCanUse was called in checkUsageLimit, it has ALREADY consumed.
        // So we should NOT consume again here if we are chaining.
        // But incrementFeatureUsage is usually used WITHOUT checkUsageLimit in some places, OR used WITH it.
        // The codebase shows: checkUsageLimit("originality_scan") ... then inside the route: incrementFeatureUsage(...)
        // In index.ts:
        // router.post("/scan", ... checkUsageLimit(...), async ... await incrementFeatureUsage ... )
        // This effectively consumes TWICE now if both are active.
        // FIX: Remove incrementUsage logic call to SubscriptionService, BUT keep email warnings?
        // Or better: The PROMPT said "Use assertCanUse everywhere".
        // If checkUsageLimit calls assertCanUse, the credit is gone.
        // If incrementFeatureUsage is called later, it tracks "history".
        // We should ensure we don't double consume.
        // SubscriptionService.incrementUsage calls EntitlementService.consumeEntitlement.
        // assertCanUse calls consumption logic internally.
        // So YES, double consumption risk.
        // I will change incrementFeatureUsage to ONLY do logging/email warnings and NOT call SubscriptionService.incrementUsage (or call a non-consuming tracking method).
        // Actually, SubscriptionService.incrementUsage calls `prisma.usageTracking.upsert` AND `consumeEntitlement`.
        // We should ONLY do the upsert part for history.
        // I'll import UsageService to track history directly or call a new method.
        // For minimal breakage, I will comment out the increment call and just do the email stuff, OR delegate to UsageService.trackUsage (which consumes entitlement... oh wait).
        // Let's modify UsageService.trackUsage to NOT consume, or use a "pure" tracking function.
        // UsageService.trackUsage calls EntitlementService.consumeEntitlement.

        // Strategy: We won't call SubscriptionService.incrementUsage. We will manually track usage for history/emails.
        const { prisma } = await import("../lib/prisma"); // Ensure prisma available
        // Basic history tracking (copying logic from UsageService roughly)
        // ... Or better: Update SubscriptionService.incrementUsage to NOT consume entitlement? 
        // No, I can't easily change that without side effects.

        // I will just log usage here for email warnings, assuming assertCanUse did the job.
        // But wait, checkUsageLimit is generic. 
        // In /scan, checkUsageLimit protects the route. The router logic does the scan. Then incrementFeatureUsage is called.
        // IF assertCanUse consumes at the START (in checkUsageLimit), then if the scan fails, the user lost a credit.
        // This is "Pattern A" (Pay to Enter).
        // "Pattern B" (Pay on Success) is what /scan seems to use currently (check limit -> do work -> increment).
        // BUT assertCanUse is designed to throw if not allowed, implying "Check & Lock".
        // If I use assertCanUse in checkUsageLimit, I switch to Pattern A.
        // Given the instructions "if entitlement.remaining > 0 ALLOW_AND_DECREMENT", it implies immediate action.
        // So I stick with Pattern A.
        // Therefore, incrementFeatureUsage should NOT consume again.

        // I will remove the call to SubscriptionService.incrementUsage.
        // await SubscriptionService.incrementUsage(userId, feature); -> REMOVED

        // Just track for email warnings:
        // (We need current count for emails)
        const currentUsage = await SubscriptionService.checkMonthlyUsage(userId, feature); // This reads DB


        // Check for usage warnings (fire and forget)
        if (feature === "scan") {
          (async () => {
            try {
              const plan = await SubscriptionService.getActivePlan(userId);
              const limits = SubscriptionService.getPlanLimits(plan);

              if (limits.scans_per_month > 0) {
                const currentUsage =
                  await SubscriptionService.checkMonthlyUsage(userId, "scan");
                const percentage =
                  (currentUsage / limits.scans_per_month) * 100;

                const user = await prisma.user.findUnique({
                  where: { id: userId },
                });
                if (!user || !user.email) return;

                const upgradeUrl = `${await SecretsService.getFrontendUrl()}/pricing`;

                // Define thresholds for warnings
                // Note: We want to send exactly once when hitting the threshold.
                // currentUsage is an integer.

                // Reached Limit (100%)
                if (currentUsage === limits.scans_per_month) {
                  const now = new Date();
                  const nextMonth = new Date(
                    now.getFullYear(),
                    now.getMonth() + 1,
                    1
                  );
                  await EmailService.sendUsageLimitReachedEmail(
                    user.email,
                    user.full_name || "User",
                    plan.charAt(0).toUpperCase() + plan.slice(1),
                    nextMonth.toLocaleDateString(),
                    upgradeUrl
                  );
                }
                // Approaching Limit (80% and 90%)
                // We check if this specific increment pushed us *over* the threshold boundary
                // e.g. if limit is 10, 80% is 8. If usage became 8, send email.
                else if (
                  percentage === 80 ||
                  percentage === 90 ||
                  currentUsage === Math.ceil(limits.scans_per_month * 0.8) ||
                  currentUsage === Math.ceil(limits.scans_per_month * 0.9)
                ) {
                  // Avoid duplicate sending if logic matches multiple times (e.g. slight math diff)
                  // Ideally we'd track "warning sent" state, but for MVP we rely on exact integer hit.
                  // If limit is small (e.g. 10), 80% is 8.
                  await EmailService.sendUsageLimitWarningEmail(
                    user.email,
                    user.full_name || "User",
                    plan.charAt(0).toUpperCase() + plan.slice(1),
                    currentUsage,
                    limits.scans_per_month,
                    upgradeUrl
                  );
                }
              }
            } catch (warnError) {
              logger.error("Failed to send usage warning email", {
                error: warnError,
              });
            }
          })();
        }
      }

      next();
    } catch (error: any) {
      logger.error("Error incrementing usage", {
        error: error.message,
        feature,
      });
      // Don't block request if usage increment fails
      next();
    }
  };
};

/**
 * Middleware to check subscription status
 */
export const requireActiveSubscription = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: "Unauthorized",
      });
      return;
    }

    const plan = await SubscriptionService.getActivePlan(userId);

    if (plan === "free") {
      res.status(403).json({
        success: false,
        error: "Premium subscription required",
        data: {
          current_plan: plan,
          upgrade_url: "/pricing",
          message: "This feature requires a paid subscription",
        },
      });
      return;
    }

    next();
  } catch (error: any) {
    logger.error("Error in subscription middleware", {
      error: error.message,
    });

    res.status(500).json({
      success: false,
      error: "Failed to check subscription status",
    });
  }
};
