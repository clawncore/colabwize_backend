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

    // OPTIMIZATION: Removed strict ensureLemonCustomer check to prevent blocking login.
    // We now rely on lazy creation during checkout/portal access or asynchronous background sync.
    // await SubscriptionService.ensureLemonCustomer(user);

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
      // 1. FETCH SUBSCRIPTION FIRST (Critical Path)
      const subResult = await withTimeout(SubscriptionService.getUserSubscription(user.id), DB_TIMEOUT_MS);

      const subscriptionForUsage = subResult === "TIMEOUT" ? undefined : subResult;

      // 2. FETCH OTHERS IN PARALLEL (Dependent on Step 1 for optimization)
      const [usageResult, creditResult, totalResult] = await Promise.all([
        withTimeout(UsageService.getCurrentUsage(user.id, subscriptionForUsage), DB_TIMEOUT_MS),
        withTimeout(CreditService.getBalance(user.id), DB_TIMEOUT_MS),
        withTimeout(prisma.originalityScan.count({ where: { user_id: user.id } }), DB_TIMEOUT_MS)
      ]);

      return { subResult, usageResult, creditResult, totalResult };
    };

    // RACE AGAINST HARD HTTP TIMEOUT
    const result = await Promise.race([
      executeLogic(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("HTTP_HARD_TIMEOUT")), TOTAL_TIMEOUT_MS))
    ]);

    const { subResult, usageResult, creditResult, totalResult } = result as any;

    // DERIVE STATE
    const isTimeout = subResult === "TIMEOUT";
    const source = isTimeout ? "fallback" : "database";
    const generatedAt = new Date().toISOString();

    // Default Fallback State (Free)
    let plan = "free";
    let status = "active";
    let subscriptionData = subResult === "TIMEOUT" ? null : subResult;

    // Resolve Plan from Subscription (No extra DB call)
    console.log('[SUBSCRIPTION_RESOLVE]', {
      userId: user.id,
      dbPlan: subscriptionData?.plan,
      dbStatus: subscriptionData?.status,
      isTimeout
    });

    if (subscriptionData && ["active", "trialing", "on_trial", "past_due"].includes(subscriptionData.status)) {
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

    // Is total documents timed out?
    const totalDocuments = totalResult === "TIMEOUT" ? 0 : totalResult;

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
      totalDocuments,
      autoUseCredits: user.auto_use_credits ?? true,
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
      totalDocuments: 0,
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
    const { plan, billingPeriod = "monthly", policyAccepted } = req.body;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }
    // 1. DUPLICATE SUBSCRIPTION CHECK (Strict Policy)
    const currentSubscription = await SubscriptionService.getUserSubscription(user.id);
    if (currentSubscription &&
      ["active", "trialing", "past_due", "on_trial"].includes(currentSubscription.status) &&
      !currentSubscription.cancel_at_period_end &&
      currentSubscription.plan !== "free"
    ) {
      // Allow ONLY if it's a credit purchase (PAYG / Credits)
      // If plan is 'credits_XX' or 'payg' it is allowed as an add-on.
      // But if plan is 'student' or 'researcher' -> BLOCK
      if (!plan.startsWith("credits_") && plan !== "payg") {
        return res.status(409).json({
          success: false,
          message: "You already have an active subscription. Please manage your existing plan to upgrade or switch.",
          error_code: "DUPLICATE_SUBSCRIPTION"
        });
      }
    }

    // 2. POLICY ACCEPTANCE CHECK (Legal Requirement)
    // Only require policy acceptance for subscription plans, not for one-time credit purchases
    const isSubscriptionPlan = !plan.startsWith("credits_") && plan !== "payg";

    if (isSubscriptionPlan && policyAccepted !== true) {
      return res.status(400).json({
        success: false,
        message: "You must accept the Refund Policy and Terms of Service to proceed.",
        error_code: "POLICY_NOT_ACCEPTED"
      });
    }

    // 3. PERSIST POLICY ACCEPTANCE (only for subscription plans)
    // Always update to latest timestamp to prove acceptance of current terms
    if (isSubscriptionPlan) {
      await prisma.user.update({
        where: { id: user.id },
        data: { policy_accepted_at: new Date() }
      });
    }

    // Validate plan - accept subscription plans and credit packages
    const validPlans = [
      "student",
      "researcher",
      "payg",
      "credits_trial",
      "credits_standard",
      "credits_power",
      // Legacy support
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
    } else if (plan === "credits_trial" || plan === "credits_10") {
      // Trial package: 5 credits for $1.99
      variantId = config.credits10VariantId || "";
    } else if (plan === "credits_standard" || plan === "credits_25") {
      // Standard package: 25 credits for $6.99
      variantId = config.credits25VariantId || "";
    } else if (plan === "credits_power" || plan === "credits_50") {
      // Power package: 50 credits for $12.99
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

    // Ensure customer exists before fetching methods (though methods come from our DB, 
    // it's good practice to ensure the link exists if we wanted to fetch from LS)
    await SubscriptionService.ensureLemonCustomer(user);

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

    // Ensure customer exists so we don't have dangling users without billing profiles
    await SubscriptionService.ensureLemonCustomer(user);

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
      invoice_id: invoice.id,
      issued_at: invoice.created_at.toISOString(),
      amount: invoice.amount / 100, // Convert from cents
      currency: "USD",
      status: invoice.status as "paid" | "pending" | "failed" | "refunded",
      hosted_invoice_url: invoice.receipt_url || undefined,
      pdf_url: undefined, // Not currently stored
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
 * Update payment method (Get Portal URL)
 * Refactored to support streamlined pipeline (Create Customer if missing)
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

      // 1. Ensure Lemon Customer Exists using the shared helper
      const customerId = await SubscriptionService.ensureLemonCustomer(user);

      // 2. Generate Portal URL
      // We prioritize the Customer Portal URL which handles all billing needs
      const redirectUrl = await LemonSqueezyService.getCustomerPortalUrl(customerId);

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
 * POST /api/subscription/credits/auto-use
 * Update auto-use credits preference
 */
router.post("/credits/auto-use", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;
    const { enabled } = req.body;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    if (typeof enabled !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "Enabled status required (boolean)",
      });
    }

    await SubscriptionService.updateAutoUseCredits(user.id, enabled);

    return res.status(200).json({
      success: true,
      message: `Auto-use credits ${enabled ? 'enabled' : 'disabled'}`,
      autoUseCredits: enabled
    });
  } catch (error) {
    console.error("Update auto-use credits error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update preference",
    });
  }
});

/**
 * GET /api/subscription/credits/history
 * Get credit transaction history
 */
router.get("/credits/history", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    const history = await prisma.creditTransaction.findMany({
      where: { user_id: user.id },
      orderBy: { created_at: "desc" },
      take: 50, // Limit to last 50 transactions
    });

    return res.status(200).json({
      success: true,
      history,
    });
  } catch (error) {
    console.error("Get credit history error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch credit history",
    });
  }
});

/**
 * GET /api/subscription/billing/overview
 * Get comprehensive billing overview with metrics and trends
 * Single source of truth for billing page
 */
router.get("/billing/overview", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    // Fetch all data in parallel
    const [subscription, usage, paymentMethods, documentsThisMonth, documentsLastMonth, dailyTrend] = await Promise.all([
      SubscriptionService.getUserSubscription(user.id),
      UsageService.getCurrentUsage(user.id),
      prisma.paymentMethod.findMany({
        where: { user_id: user.id },
        orderBy: { created_at: "desc" },
        take: 1,
      }),
      // Get documents processed this month
      prisma.document.count({
        where: {
          user_id: user.id,
          uploaded_at: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
      // Get documents processed last month
      prisma.document.count({
        where: {
          user_id: user.id,
          uploaded_at: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
            lt: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
          },
        },
      }),
      // Get daily document count for last 30 days
      (async () => {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const documents = await prisma.document.findMany({
          where: {
            user_id: user.id,
            uploaded_at: { gte: thirtyDaysAgo },
          },
          select: { uploaded_at: true },
        });

        // Group by day
        const dailyCounts: number[] = Array(30).fill(0);
        documents.forEach((doc: { uploaded_at: Date }) => {
          const daysDiff = Math.floor(
            (Date.now() - new Date(doc.uploaded_at).getTime()) / (1000 * 60 * 60 * 24)
          );
          if (daysDiff >= 0 && daysDiff < 30) {
            dailyCounts[29 - daysDiff]++;
          }
        });

        return dailyCounts;
      })(),
    ]);

    // Get plan info
    const plan = subscription && ["active", "trialing", "on_trial", "past_due"].includes(subscription.status)
      ? subscription.plan
      : "free";
    const limits = SubscriptionService.getPlanLimits(plan);

    // Build response matching professional SaaS pattern
    return res.status(200).json({
      success: true,
      plan: {
        name: plan.charAt(0).toUpperCase() + plan.slice(1),
        price: plan === "free" ? 0 : plan === "student" ? 4.99 : 12.99,
        interval: subscription?.current_period_start ? "month" : undefined,
        status: subscription?.status || "active",
        renewsAt: subscription?.current_period_end || null,
      },
      usage: {
        monthlyScans: {
          used: usage?.scan || 0,
          limit: limits.scans_per_month === -1 ? null : limits.scans_per_month,
        },
        originalityScans: {
          used: usage?.originality_scan || 0,
          limit: limits.originality_scan === -1 ? null : limits.originality_scan,
        },
        citationChecks: {
          used: usage?.citation_audit || 0,
          limit: limits.citation_audit === -1 ? null : limits.citation_audit,
        },
        certificates: {
          used: usage?.certificate || 0,
          limit: limits.certificate === -1 ? null : limits.certificate,
        },
      },
      metrics: {
        documentsThisMonth,
        documentsLastMonth,
      },
      trends: {
        documentsDaily: dailyTrend,
      },
      paymentMethod: paymentMethods.length > 0
        ? {
          brand: paymentMethods[0].type,
          last4: paymentMethods[0].last_four || "",
        }
        : null,
    });
  } catch (error) {
    console.error("Get billing overview error:", error);
    return res.status(200).json({
      success: false,
      message: "Service temporarily unavailable. Please try again later.",
    });
  }
});

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
