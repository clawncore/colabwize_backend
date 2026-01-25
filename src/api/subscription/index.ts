import express from "express";
import { SubscriptionService } from "../../services/subscriptionService";
import { UsageService } from "../../services/usageService";
import { CreditService } from "../../services/CreditService";
import { LemonSqueezyService } from "../../services/lemonSqueezyService";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";
import { SecretsService } from "../../services/secrets-service";
import { prisma } from "../../lib/prisma";

const router = express.Router();

/**
 * GET /api/subscription/plans
 * Get all available pricing plans
 */
router.get("/plans", async (req, res) => {
  try {
    const plans = SubscriptionService.getAvailablePlans();
    return res.status(200).json({
      success: true,
      plans,
    });
  } catch (error) {
    console.error("Get plans error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get plans",
    });
  }
});

/**
 * GET /api/subscription/current
 * Get user's current subscription and usage
 */
/**
 * GET /api/subscription/current
 * Get user's current subscription and usage
 * HARDENED: Strict timeouts, parallel execution, fail-safe fallback
 */
router.get("/current", authenticateHybridRequest, async (req, res) => {
  const DB_TIMEOUT_MS = 15000; // 15 seconds strict budget for DB
  const TOTAL_TIMEOUT_MS = 30000; // 30 seconds hard cap for entire request
  const start = Date.now();

  try {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    // Helper for timeout wrapping
    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T | "TIMEOUT"> => {
      let timeoutId: NodeJS.Timeout;
      const timeoutPromise = new Promise<"TIMEOUT">((resolve) => {
        timeoutId = setTimeout(() => resolve("TIMEOUT"), ms);
      });

      return Promise.race([
        promise.then(res => {
          clearTimeout(timeoutId);
          return res;
        }).catch(err => {
          clearTimeout(timeoutId);
          console.error("Dependency failed:", err);
          return "TIMEOUT" as const; // Treat error as timeout/failure for fallback
        }),
        timeoutPromise
      ]);
    };

    // EXECUTE CORE LOGIC WRAPPED IN TOTAL DEADLINE
    const executeLogic = async () => {
      // EXECUTE IN PARALLEL
      // We avoid calling SubscriptionService.getActivePlan() afterwards to prevent 2nd DB call
      const [subResult, usageResult, creditResult] = await Promise.all([
        withTimeout(SubscriptionService.getUserSubscription(user.id), DB_TIMEOUT_MS),
        withTimeout(UsageService.getCurrentUsage(user.id), DB_TIMEOUT_MS),
        withTimeout(CreditService.getBalance(user.id), DB_TIMEOUT_MS)
      ]);

      return { subResult, usageResult, creditResult };
    };

    // RACE AGAINST HARD HTTP TIMEOUT
    const result = await Promise.race([
      executeLogic(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("HTTP_HARD_TIMEOUT")), TOTAL_TIMEOUT_MS))
    ]);

    const { subResult, usageResult, creditResult } = result as any;

    // DERIVE STATE
    const isTimeout = subResult === "TIMEOUT";
    const source = isTimeout ? "fallback" : "database";
    const generatedAt = new Date().toISOString();

    // Default Fallback State (Free)
    let plan = "free";
    let status = "active";
    let subscriptionData = subResult === "TIMEOUT" ? null : subResult;

    // Resolve Plan from Subscription (No extra DB call)
    if (subscriptionData && ["active", "trialing"].includes(subscriptionData.status)) {
      plan = subscriptionData.plan;
    } else if (isTimeout) {
      status = "unknown"; // UI should show warning/cached state
    } else {
      status = "inactive"; // Valid response, but no active sub
    }

    // Resolve Limits & Usage
    const limits = SubscriptionService.getPlanLimits(plan);

    // If usage timed out, return safe empty object (don't block UI)
    const usage = usageResult === "TIMEOUT" ? {
      documents: 0,
      words: 0,
      scans: 0,
      // ... add other zeroed counters if needed
    } : usageResult;

    // Is credits timed out?
    const creditBalance = creditResult === "TIMEOUT" ? 0 : creditResult;

    const responseDuration = Date.now() - start;
    if (responseDuration > 1000) {
      console.warn(`[SLOW RESPONSE] /subscription/current took ${responseDuration}ms`);
    }

    return res.status(200).json({
      success: true,
      status,      // active | inactive | unknown
      plan,        // free | student | pro | ...
      limits,
      usage,
      creditBalance,
      source,
      generatedAt,
      // Keep legacy fields for backward compatibility if needed, but prefer flat structure above
      subscription: subscriptionData || { plan: "free", status: status === "unknown" ? "unknown" : "active" }
    });

  } catch (error: any) {
    const isHardTimeout = error.message === "HTTP_HARD_TIMEOUT";
    console.error(isHardTimeout ? "CRITICAL: HTTP Hard Timeout in /subscription/current" : "Critical error in /subscription/current:", error);

    // FAIL SAFE: Never return 500 for this critical endpoint
    return res.status(200).json({
      success: true,
      status: "unknown",
      plan: "free",
      limits: SubscriptionService.getPlanLimits("free"),
      usage: {},
      creditBalance: 0,
      source: isHardTimeout ? "fallback_timeout" : "fallback_error",
      generatedAt: new Date().toISOString()
    });
  }
});

/**
 * POST /api/subscription/checkout
 * Create checkout session for a plan
 */
router.post("/checkout", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;
    const { plan, billingPeriod = "monthly" } = req.body;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    // Validate plan - accept subscription plans and credit packages
    const validPlans = [
      "student",
      "researcher",
      "payg",
      "credits_10",
      "credits_25",
      "credits_50",
    ];
    if (!plan || !validPlans.includes(plan)) {
      return res.status(400).json({
        success: false,
        message: "Invalid plan selected",
      });
    }

    // Get variant ID from config based on plan and billing period
    const config = await SecretsService.getLemonSqueezyConfig();
    let variantId: string;

    if (plan === "student") {
      variantId =
        billingPeriod === "yearly"
          ? config.studentProAnnualVariantId || ""
          : config.studentProMonthlyVariantId || "";
    } else if (plan === "researcher") {
      variantId =
        billingPeriod === "yearly"
          ? config.researcherAnnualVariantId || ""
          : config.researcherMonthlyVariantId || "";
    } else if (plan === "payg") {
      // Legacy PAYG - generic one-time variant
      variantId = config.onetimeVariantId || "";
    } else if (plan === "credits_10") {
      variantId = config.credits10VariantId || "";
    } else if (plan === "credits_25") {
      variantId = config.credits25VariantId || "";
    } else if (plan === "credits_50") {
      variantId = config.credits50VariantId || "";
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid plan",
      });
    }

    if (!variantId) {
      return res.status(500).json({
        success: false,
        message: "Plan configuration not found",
      });
    }

    // Create checkout URL
    const checkoutUrl = await LemonSqueezyService.createCheckout({
      variantId,
      userEmail: user.email,
      userId: user.id,
      customData: { plan, billingPeriod },
    });

    return res.status(200).json({
      success: true,
      checkoutUrl,
    });
  } catch (error) {
    console.error("Create checkout error:", error);
    return res.status(200).json({
      success: false,
      message: "Service temporarily unavailable. Please try again later.",
    });
  }
});

/**
 * POST /api/subscription/portal
 * Get customer portal URL
 */
router.post("/portal", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    const subscription = await SubscriptionService.getUserSubscription(user.id);

    if (!subscription || !subscription.lemonsqueezy_customer_id) {
      return res.status(400).json({
        success: false,
        message: "No active subscription found",
      });
    }

    const portalUrl = await LemonSqueezyService.getCustomerPortalUrl(
      subscription.lemonsqueezy_customer_id
    );

    return res.status(200).json({
      success: true,
      portalUrl,
    });
  } catch (error) {
    console.error("Get portal error:", error);
    return res.status(200).json({
      success: false,
      message: "Service temporarily unavailable. Please try again later.",
    });
  }
});

/**
 * POST /api/subscription/cancel
 * Cancel subscription at period end
 */
router.post("/cancel", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    await SubscriptionService.cancelSubscription(user.id);

    return res.status(200).json({
      success: true,
      message: "Subscription canceled successfully",
    });
  } catch (error) {
    console.error("Cancel subscription error:", error);
    return res.status(200).json({
      success: false,
      message: "Service temporarily unavailable. Please try again later.",
    });
  }
});

/**
 * POST /api/subscription/reactivate
 * Reactivate canceled subscription
 */
router.post("/reactivate", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    await SubscriptionService.reactivateSubscription(user.id);

    return res.status(200).json({
      success: true,
      message: "Subscription reactivated successfully",
    });
  } catch (error) {
    console.error("Reactivate subscription error:", error);
    return res.status(200).json({
      success: false,
      message: "Service temporarily unavailable. Please try again later.",
    });
  }
});

/**
 * GET /api/subscription/usage
 * Get usage statistics
 */
router.get("/usage", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    const months = parseInt(req.query.months as string) || 3;
    const usage = await UsageService.getUsageHistory(user.id, months);

    return res.status(200).json({
      success: true,
      usage,
    });
  } catch (error) {
    console.error("Get usage error:", error);
    return res.status(200).json({
      success: false,
      message: "Service temporarily unavailable. Please try again later.",
      usage: [], // Degraded response
    });
  }
});

/**
 * GET /api/subscription/certificates/retention
 * Get certificate retention info for user
 */
router.get(
  "/certificates/retention",
  authenticateHybridRequest,
  async (req, res) => {
    try {
      const user = (req as any).user;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Not authenticated",
        });
      }

      // Import the service dynamically to avoid circular dependencies
      const { CertificateRetentionService } =
        await import("../../services/certificateRetentionService");
      const retentionInfo = await CertificateRetentionService.getRetentionInfo(
        user.id
      );

      return res.status(200).json({
        success: true,
        ...retentionInfo,
      });
    } catch (error) {
      console.error("Get certificate retention error:", error);
      return res.status(200).json({
        success: false,
        message: "Service temporarily unavailable. Please try again later.",
      });
    }
  }
);

/**
 * GET /api/subscription/payment-methods
 * Get user's payment methods
 */
router.get("/payment-methods", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    // Fetch payment methods from database
    const paymentMethods = await prisma.paymentMethod.findMany({
      where: {
        user_id: user.id,
      },
      orderBy: {
        created_at: "desc",
      },
    });

    // Transform to match frontend interface
    const transformedPaymentMethods = paymentMethods.map((method: any) => ({
      id: method.id,
      type: method.type as "visa" | "mastercard" | "amex" | "paypal",
      lastFour: method.last_four || "",
      expiryMonth: method.expiry_month || 0,
      expiryYear: method.expiry_year || 0,
      isDefault: method.is_default,
    }));

    return res.status(200).json({
      success: true,
      paymentMethods: transformedPaymentMethods,
    });
  } catch (error) {
    console.error("Get payment methods error:", error);
    return res.status(200).json({
      success: true,
      paymentMethods: [], // Degraded state: empty list
      message: "Service temporarily unavailable. Could not fetch payment methods.",
    });
  }
});

/**
 * GET /api/subscription/invoices
 * Get user's billing history
 */
router.get("/invoices", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    // Fetch invoices from database
    const invoices = await prisma.paymentHistory.findMany({
      where: {
        user_id: user.id,
      },
      orderBy: {
        created_at: "desc",
      },
      take: 20, // Limit to last 20 invoices
    });

    // Transform to match frontend interface
    const transformedInvoices = invoices.map((invoice: any) => ({
      id: invoice.id,
      date: invoice.created_at.toISOString(),
      description:
        invoice.description || `Payment for ${invoice.amount / 100} USD`,
      amount: invoice.amount / 100, // Convert from cents
      status: invoice.status as "paid" | "pending" | "failed",
      receiptUrl: invoice.receipt_url || undefined,
    }));

    return res.status(200).json({
      success: true,
      invoices: transformedInvoices,
    });
  } catch (error) {
    console.error("Get invoices error:", error);
    return res.status(200).json({
      success: true, // Don't crash UI
      invoices: [], // Return empty list
      message: "Service temporarily unavailable. Could not fetch invoices.",
    });
  }
});

/**
 * DEPRECATED: POST /api/subscription/payment-methods
 * This endpoint has been removed for security reasons.
 * Use LemonSqueezy hosted pages for payment method management.
 */

// Deleted routes for adding/removing/setting default payment methods manually


/**
 * POST /api/subscription/payment-methods/update
 * Update payment method
 */
router.post(
  "/payment-methods/update",
  authenticateHybridRequest,
  async (req, res) => {
    try {
      const user = (req as any).user;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Not authenticated",
        });
      }

      // Get user's subscription to find customer ID
      const subscription = await SubscriptionService.getUserSubscription(
        user.id
      );

      if (!subscription || !subscription.lemonsqueezy_customer_id) {
        // If no subscription/customer ID, we can't get a portal URL
        // Fallback or error - maybe user has no payment method yet?
        return res.status(400).json({
          success: false,
          message:
            "No active subscription found to update payment method. Please add a payment method directly or subscribe first.",
        });
      }

      // Get Update Payment Method URL from LemonSqueezy (prefer specific subscription update URL)
      let redirectUrl;
      if (subscription.lemonsqueezy_subscription_id) {
        redirectUrl = await LemonSqueezyService.getUpdatePaymentMethodUrl(
          subscription.lemonsqueezy_subscription_id
        );
      } else {
        redirectUrl = await LemonSqueezyService.getCustomerPortalUrl(
          subscription.lemonsqueezy_customer_id
        );
      }

      return res.status(200).json({
        success: true,
        redirectUrl,
      });
    } catch (error) {
      console.error("Update payment method error:", error);
      return res.status(200).json({
        success: false,
        message: "Service temporarily unavailable. Please try again later.",
      });
    }
  }
);

/**
 * GET /api/subscription/features/:feature
 * Check if user has access to a specific feature
 */
router.get(
  "/features/:feature",
  authenticateHybridRequest,
  async (req, res) => {
    try {
      const user = (req as any).user;
      const { feature } = req.params;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Not authenticated",
        });
      }

      if (!feature) {
        return res.status(400).json({
          success: false,
          message: "Feature name is required",
        });
      }

      const hasAccess = await SubscriptionService.checkFeatureAccess(
        user.id,
        feature as string
      );

      return res.status(200).json({
        success: true,
        hasAccess,
        feature,
      });
    } catch (error) {
      console.error("Check feature access error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to check feature access",
      });
    }
  }
);

export default router;
