import { Request, Response, NextFunction } from "express";
import { SubscriptionService } from "../services/subscriptionService";
import { EmailService } from "../services/emailService";
import { prisma } from "../lib/prisma";
import { SecretsService } from "../services/secrets-service";
import logger from "../monitoring/logger";

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

      // Check if user can perform action
      const canPerform = await SubscriptionService.canPerformAction(
        userId,
        feature
      );

      if (!canPerform) {
        const plan = await SubscriptionService.getActivePlan(userId);
        const limits = SubscriptionService.getPlanLimits(plan);
        const currentUsage = await SubscriptionService.checkMonthlyUsage(
          userId,
          feature
        );

        // Determine limit value for error message
        let limitValue = 0;
        let limitKey = feature;
        if (feature === "scan") limitKey = "scans_per_month";

        if (limitKey in limits) {
          limitValue = limits[limitKey as keyof typeof limits] as number;
        }

        logger.warn("Usage limit exceeded", {
          userId,
          plan,
          feature,
          currentUsage,
          limit: limitValue,
        });

        res.status(403).json({
          success: false,
          error: `${feature} usage limit reached`,
          data: {
            current_plan: plan,
            usage: currentUsage,
            limit: limitValue,
            upgrade_url: "/pricing",
            message:
              plan === "free"
                ? `You've reached your free limit for ${feature}. Upgrade to continue!`
                : `You've reached your limit of ${limitValue} for ${feature} this month. Upgrade for more!`,
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
        await SubscriptionService.incrementUsage(userId, feature);

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
