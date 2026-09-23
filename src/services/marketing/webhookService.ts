/**
 * EmailOctopus Webhook Service
 *
 * Handles incoming webhooks from EmailOctopus, including signature
 * verification to ensure the request originates from EmailOctopus.
 *
 * EmailOctopus webhooks include a `signature` header that is an HMAC-SHA256
 * hash of the raw request body, using the API key as the secret.
 *
 * Docs: https://emailoctopus.com/api-documentation/webhooks
 */

import logger from "../../monitoring/logger";
import { getEmailOctopusApiKey } from "./emailOctopusClient";
import * as crypto from "crypto";

export interface WebhookResult {
  success: boolean;
  error?: string;
}

/**
 * Verifies the HMAC signature from EmailOctopus.
 *
 * EmailOctopus sends the signature in the `signature` header.
 * It's an HMAC-SHA256 of the raw request body using your API key as the secret.
 */
export function verifyEmailOctopusSignature(
  signature: string,
  body: string,
  apiKey: string,
): boolean {
  if (!signature || !apiKey) return false;

  try {
    const expectedSignature = crypto
      .createHmac("sha256", apiKey)
      .update(body)
      .digest("hex");

    // Use timing-safe comparison to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex"),
    );
  } catch {
    return false;
  }
}

/**
 * Processes an incoming EmailOctopus webhook event.
 *
 * Expected events:
 * - campaign.sent — Campaign has been sent
 * - campaign.delivered — Campaign has been delivered to all recipients
 * - campaign.bounced — Campaign bounced
 * - subscriber.subscribed — Subscriber joined the list
 * - subscriber.unsubscribed — Subscriber unsubscribed
 */
export async function processEmailOctopusWebhook(
  headers: Record<string, string>,
  body: string,
): Promise<WebhookResult> {
  try {
    const signature = headers["signature"] || headers["Signature"];
    const apiKey = getEmailOctopusApiKey();

    if (!apiKey) {
      logger.warn("EmailOctopus webhook received but API key not configured");
      return { success: false, error: "EmailOctopus API key not configured" };
    }

    if (!signature) {
      logger.warn("EmailOctopus webhook received without signature header");
      return { success: false, error: "Missing signature header" };
    }

    const isValid = verifyEmailOctopusSignature(signature, body, apiKey);

    if (!isValid) {
      logger.warn("EmailOctopus webhook signature verification failed");
      return { success: false, error: "Invalid signature" };
    }

    const payload = JSON.parse(body);
    const eventType = payload?.type || payload?.event;
    const data = payload?.data || payload;

    logger.info(`EmailOctopus webhook: ${eventType}`, {
      eventType,
      campaignId: data?.campaign_id || data?.id,
      email: data?.email,
    });

    // Log the webhook event for audit trail
    // In a production system, you'd integrate this with your audit log
    // and potentially trigger notifications, update metrics, etc.
    switch (eventType) {
      case "campaign.sent":
        logger.info(`Campaign ${data?.id} was sent via EmailOctopus`);
        break;
      case "campaign.delivered":
        logger.info(`Campaign ${data?.id} was delivered via EmailOctopus`);
        break;
      case "campaign.bounced":
        logger.warn(`Campaign ${data?.id} bounced via EmailOctopus`);
        break;
      case "subscriber.subscribed":
        logger.info(`Subscriber ${data?.email} joined via EmailOctopus`);
        break;
      case "subscriber.unsubscribed":
        logger.info(`Subscriber ${data?.email} unsubscribed via EmailOctopus`);
        break;
      default:
        logger.debug(`Unhandled EmailOctopus webhook event: ${eventType}`);
    }

    return { success: true };
  } catch (error: any) {
    logger.error("Error processing EmailOctopus webhook:", error);
    return { success: false, error: error.message };
  }
}
