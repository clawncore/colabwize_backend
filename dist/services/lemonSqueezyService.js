"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LemonSqueezyService = void 0;
const secrets_service_1 = require("./secrets-service");
const logger_1 = __importDefault(require("../monitoring/logger"));
const crypto_1 = __importDefault(require("crypto"));
/**
 * LemonSqueezy Service for payment processing
 * Handles checkout creation, subscription management, and webhooks
 */
class LemonSqueezyService {
    static apiKey = null;
    static storeId = null;
    static webhookSecret = null;
    static baseUrl = "https://api.lemonsqueezy.com/v1";
    /**
     * Initialize LemonSqueezy configuration
     */
    static async initialize() {
        if (this.apiKey)
            return; // Already initialized
        this.apiKey = await secrets_service_1.SecretsService.getLemonsqueezyApiKey();
        this.storeId = await secrets_service_1.SecretsService.getLemonsqueezyStoreId();
        this.webhookSecret = await secrets_service_1.SecretsService.getLemonsqueezyWebhookSecret();
        logger_1.default.info("LemonSqueezy service initialized", {
            hasApiKey: !!this.apiKey,
            hasStoreId: !!this.storeId,
        });
    }
    /**
     * Make API request to LemonSqueezy
     */
    static async makeRequest(endpoint, method = "GET", body) {
        await this.initialize();
        if (!this.apiKey) {
            throw new Error("LemonSqueezy API key not configured");
        }
        const url = `${this.baseUrl}/${endpoint}`;
        const options = {
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
            logger_1.default.error("LemonSqueezy API error detail", {
                status: response.status,
                endpoint,
                method,
                errors: data.errors,
            });
            const error = new Error(`LemonSqueezy API error: ${response.status}`);
            error.status = response.status;
            error.data = data;
            throw error;
        }
        return data;
    }
    /**
     * Create checkout URL for a product variant
     */
    static async createCheckout(params) {
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
    static async getSubscription(subscriptionId) {
        const response = await this.makeRequest(`subscriptions/${subscriptionId}`);
        return response.data;
    }
    /**
     * Cancel subscription
     */
    static async cancelSubscription(subscriptionId) {
        // Cancel AT PERIOD END, not immediately. LemonSqueezy v1 interprets a
        // DELETE as immediate cancellation (access revoked at once). To honor the
        // "retain access until the end of the current billing period" promise we
        // PATCH with `cancelled: true`, which tells LemonSqueezy to keep the
        // subscription active until `renews_at` and then stop billing.
        const body = {
            data: {
                type: "subscriptions",
                id: subscriptionId,
                attributes: {
                    cancelled: true,
                },
            },
        };
        const response = await this.makeRequest(`subscriptions/${subscriptionId}`, "PATCH", body);
        return response.data;
    }
    /**
     * Update subscription (change plan)
     */
    static async updateSubscription(subscriptionId, variantId) {
        const updateData = {
            data: {
                type: "subscriptions",
                id: subscriptionId,
                attributes: {
                    variant_id: parseInt(variantId),
                },
            },
        };
        const response = await this.makeRequest(`subscriptions/${subscriptionId}`, "PATCH", updateData);
        return response.data;
    }
    /**
     * Create a customer
     */
    static async createCustomer(email, name) {
        await this.initialize();
        if (!this.storeId) {
            throw new Error("LemonSqueezy store ID not configured");
        }
        const customerData = {
            data: {
                type: "customers",
                attributes: {
                    name,
                    email,
                },
                relationships: {
                    store: {
                        data: {
                            type: "stores",
                            id: this.storeId,
                        },
                    },
                },
            },
        };
        try {
            const response = await this.makeRequest("customers", "POST", customerData);
            return response.data;
        }
        catch (error) {
            // If customer already exists (422 email taken), fetch it instead
            if (error.status === 422) {
                const errors = error.data?.errors;
                const isEmailTaken = errors?.some((e) => e.detail?.toLowerCase().includes("email has already been taken") ||
                    e.source?.pointer === "/data/attributes/email" ||
                    e.title === "Unprocessable Entity");
                if (isEmailTaken) {
                    logger_1.default.info("Customer email taken, attempt recovery by fetching", {
                        email,
                    });
                    const existing = await this.getCustomersByEmail(email);
                    if (existing && existing.length > 0) {
                        logger_1.default.info("Found existing customer during recovery", {
                            customerId: existing[0].id,
                        });
                        return existing[0];
                    }
                    else {
                        logger_1.default.warn("Customer email taken but search returned no results. Fallback to global search.", { email });
                        // Try searching without store filter as a last resort
                        const globalSearch = await this.makeRequest(`customers?filter[email]=${encodeURIComponent(email)}`);
                        if (globalSearch.data && globalSearch.data.length > 0) {
                            logger_1.default.info("Found customer globally during recovery", {
                                customerId: globalSearch.data[0].id,
                            });
                            return globalSearch.data[0];
                        }
                    }
                }
            }
            throw error;
        }
    }
    /**
     * Get customer by email
     */
    static async getCustomersByEmail(email) {
        if (!this.storeId)
            await this.initialize();
        // Most robust way: filter by both store and email
        const response = await this.makeRequest(`customers?filter[store_id]=${this.storeId}&filter[email]=${encodeURIComponent(email)}`);
        return response.data;
    }
    /**
     * Get customer details
     */
    static async getCustomer(customerId) {
        const response = await this.makeRequest(`customers/${customerId}`);
        return response.data;
    }
    /**
     * Verify webhook signature
     * @param payload - Raw request body (Buffer or string)
     * @param signature - X-Signature header value from LemonSqueezy
     */
    static async verifyWebhookSignature(payload, signature) {
        await this.initialize(); // Ensure webhook secret is loaded from SecretsService
        if (!this.webhookSecret) {
            logger_1.default.warn("Webhook secret not configured, skipping verification");
            return true; // Allow in development
        }
        // Convert Buffer to string if needed, but use the raw bytes for HMAC
        const payloadData = Buffer.isBuffer(payload)
            ? payload
            : Buffer.from(payload, "utf8");
        const computed = crypto_1.default
            .createHmac("sha256", this.webhookSecret)
            .update(payloadData)
            .digest("hex");
        // Use timing-safe comparison to prevent timing attacks
        try {
            const isValid = crypto_1.default.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(signature, "hex"));
            if (!isValid) {
                logger_1.default.warn("Webhook signature mismatch", {
                    signatureLength: signature.length,
                    computedLength: computed.length,
                    payloadSize: payloadData.length,
                });
            }
            else {
                logger_1.default.info("Webhook signature verified successfully");
            }
            return isValid;
        }
        catch (error) {
            // timingSafeEqual throws if buffer lengths don't match
            logger_1.default.warn("Webhook signature verification failed", {
                error: error.message,
                signatureLength: signature.length,
            });
            return false;
        }
    }
    /**
     * Get customer portal URL
     * Tries to get a specific signed URL from the customer object, falls back to generic.
     */
    static async getCustomerPortalUrl(customerId) {
        try {
            // Try to fetch customer to see if there's a specific portal URL
            // (Note: LS API behavior varies, but this is the robust way)
            const customer = await this.getCustomer(customerId);
            if (customer.attributes?.urls?.customer_portal) {
                return customer.attributes.urls.customer_portal;
            }
            // Fallback: The generic my-orders page
            return "https://app.lemonsqueezy.com/my-orders";
        }
        catch (error) {
            logger_1.default.warn("Failed to fetch customer for portal URL, using fallback", {
                customerId,
                error: JSON.stringify(error, Object.getOwnPropertyNames(error)),
            });
            return "https://app.lemonsqueezy.com/my-orders";
        }
    }
    /**
     * Get update payment method URL for a specific subscription
     */
    static async getUpdatePaymentMethodUrl(subscriptionId) {
        try {
            const subscription = await this.getSubscription(subscriptionId);
            return subscription.attributes.urls.update_payment_method;
        }
        catch (error) {
            logger_1.default.error("Failed to get update payment method URL", {
                subscriptionId,
                error,
            });
            // Fallback to generic portal
            return `https://app.lemonsqueezy.com/my-orders`;
        }
    }
}
exports.LemonSqueezyService = LemonSqueezyService;
