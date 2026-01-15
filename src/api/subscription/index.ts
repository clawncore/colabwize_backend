import express from "express";
import { SubscriptionService } from "../../services/subscriptionService";
import { UsageService } from "../../services/usageService";
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
router.get("/current", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    const subscription = await SubscriptionService.getUserSubscription(user.id);
    console.log(
      "DEBUG: Fetched subscription for user",
      user.id,
      ":",
      subscription
    );
    const plan = await SubscriptionService.getActivePlan(user.id);
    const limits = SubscriptionService.getPlanLimits(plan);
    const usage = await UsageService.getCurrentUsage(user.id);

    return res.status(200).json({
      success: true,
      subscription: subscription || { plan: "free", status: "active" },
      limits,
      usage,
    });
  } catch (error) {
    console.error("Get subscription error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get subscription",
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
    return res.status(500).json({
      success: false,
      message: "Failed to create checkout",
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
    return res.status(500).json({
      success: false,
      message: "Failed to get portal URL",
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
    return res.status(500).json({
      success: false,
      message: "Failed to cancel subscription",
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
    return res.status(500).json({
      success: false,
      message: "Failed to reactivate subscription",
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
    return res.status(500).json({
      success: false,
      message: "Failed to get usage",
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
      return res.status(500).json({
        success: false,
        message: "Failed to get certificate retention info",
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
    return res.status(500).json({
      success: false,
      message: "Failed to get payment methods",
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
    return res.status(500).json({
      success: false,
      message: "Failed to get invoices",
    });
  }
});

/**
 * POST /api/subscription/payment-methods
 * Add a payment method
 */
router.post("/payment-methods", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;
    const { type, lastFour, expiryMonth, expiryYear } = req.body;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    if (!type || !lastFour || !expiryMonth || !expiryYear) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Create payment method in database
    const newPaymentMethod = await prisma.paymentMethod.create({
      data: {
        user_id: user.id,
        type,
        last_four: lastFour,
        expiry_month: expiryMonth,
        expiry_year: expiryYear,
        is_default: false, // New payment methods are not default
      },
    });

    // Transform to match frontend interface
    const transformedMethod = {
      id: newPaymentMethod.id,
      type: newPaymentMethod.type as "visa" | "mastercard" | "amex" | "paypal",
      lastFour: newPaymentMethod.last_four || "",
      expiryMonth: newPaymentMethod.expiry_month || 0,
      expiryYear: newPaymentMethod.expiry_year || 0,
      isDefault: newPaymentMethod.is_default,
    };

    return res.status(200).json({
      success: true,
      paymentMethod: transformedMethod,
    });
  } catch (error) {
    console.error("Add payment method error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to add payment method",
    });
  }
});

/**
 * POST /api/subscription/payment-methods/:id/default
 * Set default payment method
 */
router.post(
  "/payment-methods/:id/default",
  authenticateHybridRequest,
  async (req, res) => {
    try {
      const user = (req as any).user;
      const { id } = req.params;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Not authenticated",
        });
      }

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Payment method ID is required",
        });
      }

      // First, set all other payment methods to non-default
      await prisma.paymentMethod.updateMany({
        where: {
          user_id: user.id,
          is_default: true,
        },
        data: {
          is_default: false,
        },
      });

      // Then, set the specified payment method as default
      const updatedPaymentMethod = await prisma.paymentMethod.update({
        where: {
          id,
          user_id: user.id,
        },
        data: {
          is_default: true,
        },
      });

      // Transform to match frontend interface
      const transformedMethod = {
        id: updatedPaymentMethod.id,
        type: updatedPaymentMethod.type as
          | "visa"
          | "mastercard"
          | "amex"
          | "paypal",
        lastFour: updatedPaymentMethod.last_four || "",
        expiryMonth: updatedPaymentMethod.expiry_month || 0,
        expiryYear: updatedPaymentMethod.expiry_year || 0,
        isDefault: updatedPaymentMethod.is_default,
      };

      return res.status(200).json({
        success: true,
        paymentMethod: transformedMethod,
      });
    } catch (error) {
      console.error("Set default payment method error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to set default payment method",
      });
    }
  }
);

/**
 * DELETE /api/subscription/payment-methods/:id
 * Remove a payment method
 */
router.delete(
  "/payment-methods/:id",
  authenticateHybridRequest,
  async (req, res) => {
    try {
      const user = (req as any).user;
      const { id } = req.params;

      if (!user) {
        return res.status(401).json({
          success: false,
          message: "Not authenticated",
        });
      }

      if (!id) {
        return res.status(400).json({
          success: false,
          message: "Payment method ID is required",
        });
      }

      // Delete the payment method from database
      await prisma.paymentMethod.delete({
        where: {
          id,
          user_id: user.id,
        },
      });

      return res.status(200).json({
        success: true,
        message: "Payment method removed successfully",
      });
    } catch (error) {
      console.error("Remove payment method error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to remove payment method",
      });
    }
  }
);

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
      return res.status(500).json({
        success: false,
        message: "Failed to update payment method",
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
        feature
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
