import { SecretsService } from "./secrets-service";
import logger from "../monitoring/logger";
import crypto from "crypto";

/**
 * LemonSqueezy Service for payment processing
 * Handles checkout creation, subscription management, and webhooks
 */
export class LemonSqueezyService {
  private static apiKey: string | null = null;
  private static storeId: string | null = null;
  private static webhookSecret: string | null = null;
  private static baseUrl = "https://api.lemonsqueezy.com/v1";

  /**
   * Initialize LemonSqueezy configuration
   */
  static async initialize() {
    if (this.apiKey) return; // Already initialized

    this.apiKey = await SecretsService.getLemonsqueezyApiKey();
    this.storeId = await SecretsService.getLemonsqueezyStoreId();
    this.webhookSecret = await SecretsService.getLemonsqueezyWebhookSecret();

    logger.info("LemonSqueezy service initialized", {
      hasApiKey: !!this.apiKey,
      hasStoreId: !!this.storeId,
    });
  }

  /**
   * Make API request to LemonSqueezy
   */
  private static async makeRequest(
    endpoint: string,
    method: string = "GET",
    body?: any
  ) {
    await this.initialize();

    if (!this.apiKey) {
      throw new Error("LemonSqueezy API key not configured");
    }

    const url = `${this.baseUrl}/${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        Accept: "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        Authorization: `Bearer ${this.apiKey}`,
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      logger.error("LemonSqueezy API error", { status: response.status, data });
      throw new Error(`LemonSqueezy API error: ${response.status}`);
    }

    return data;
  }

  /**
   * Create checkout URL for a product variant
   */
  static async createCheckout(params: {
    variantId: string;
    userEmail: string;
    userId: string;
    customData?: Record<string, any>;
  }) {
    await this.initialize();

    if (!this.storeId) {
      throw new Error("LemonSqueezy store ID not configured");
    }

    const checkoutData = {
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: params.userEmail,
            custom: {
              user_id: params.userId,
              ...params.customData,
            },
          },
        },
        relationships: {
          store: {
            data: {
              type: "stores",
              id: this.storeId,
            },
          },
          variant: {
            data: {
              type: "variants",
              id: params.variantId,
            },
          },
        },
      },
    };

    const response = await this.makeRequest("checkouts", "POST", checkoutData);
    return response.data.attributes.url;
  }

  /**
   * Get subscription details
   */
  static async getSubscription(subscriptionId: string) {
    const response = await this.makeRequest(`subscriptions/${subscriptionId}`);
    return response.data;
  }

  /**
   * Cancel subscription
   */
  static async cancelSubscription(subscriptionId: string) {
    const response = await this.makeRequest(
      `subscriptions/${subscriptionId}`,
      "DELETE"
    );
    return response.data;
  }

  /**
   * Update subscription (change plan)
   */
  static async updateSubscription(subscriptionId: string, variantId: string) {
    const updateData = {
      data: {
        type: "subscriptions",
        id: subscriptionId,
        attributes: {
          variant_id: parseInt(variantId),
        },
      },
    };

    const response = await this.makeRequest(
      `subscriptions/${subscriptionId}`,
      "PATCH",
      updateData
    );
    return response.data;
  }

  /**
   * Get customer details
   */
  static async getCustomer(customerId: string) {
    const response = await this.makeRequest(`customers/${customerId}`);
    return response.data;
  }

  /**
   * Verify webhook signature
   */
  static verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      logger.warn("Webhook secret not configured, skipping verification");
      return true; // Allow in development
    }

    const hmac = crypto
      .createHmac("sha256", this.webhookSecret)
      .update(payload)
      .digest("hex");

    return hmac === signature;
  }

  /**
   * Get customer portal URL
   */
  static async getCustomerPortalUrl(customerId: string): Promise<string> {
    // LemonSqueezy doesn't have a direct customer portal API
    // Return the account page URL
    return `https://app.lemonsqueezy.com/my-orders`;
  }

  /**
   * Get update payment method URL for a specific subscription
   */
  static async getUpdatePaymentMethodUrl(
    subscriptionId: string
  ): Promise<string> {
    try {
      const subscription = await this.getSubscription(subscriptionId);
      return subscription.attributes.urls.update_payment_method;
    } catch (error) {
      logger.error("Failed to get update payment method URL", {
        subscriptionId,
        error,
      });
      // Fallback to generic portal
      return `https://app.lemonsqueezy.com/my-orders`;
    }
  }
}
