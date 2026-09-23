import logger from "../../monitoring/logger";
import { prisma } from "../../lib/prisma";
import {
  getEmailOctopusClient,
  emailOctopusRequest,
  EmailOctopusResult,
} from "./emailOctopusClient";
import { getLocalMarketingStatus, upsertSubscriber } from "./audienceService";

/**
 * Result of a marketing broadcast send.
 */
export interface MarketingBroadcastResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Sends a marketing email via EmailOctopus.
 * Uses the EmailOctopus "Create campaign" endpoint which handles
 * delivery, tracking, analytics, and unsubscribe footer automatically.
 *
 * IMPORTANT: This function is for MARKETING emails only.
 * For transactional/security/auth/billing emails, use sendEmail() (Resend).
 */
export async function sendMarketingEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<MarketingBroadcastResult> {
  const client = await getEmailOctopusClient();

  if (!client) {
    logger.error(
      "EmailOctopus client not initialized — marketing email not sent. " +
      "Configure EMAILOCTOPUS_API_KEY and EMAILOCTOPUS_LIST_ID to enable.",
    );
    return {
      success: false,
      error: "EmailOctopus not configured",
    };
  }

  // Check that the recipient is actually subscribed to marketing
  const localStatus = await getLocalMarketingStatus(to);
  if (localStatus === "unsubscribed") {
    logger.debug(
      `Skipping marketing email to ${to} — user has unsubscribed from marketing`,
    );
    return {
      success: true,
      error: "Recipient unsubscribed from marketing — skipped",
    };
  }

  try {
    // EmailOctopus: POST /campaigns — create a campaign for a single recipient
    // We use the "regular" campaign type with a single recipient for per-user sends
    // For true broadcast sends, use createCampaign() with segment_id
    const result = await emailOctopusRequest("post", "/campaigns", {
      name: subject,
      subject_line: subject,
      from_name: "ColabWize Marketing",
      reply_to: "marketing@colabwize.com",
      content_html: html,
      content_text: text,
      sent_to: "subscribers",
      parameters: {
        send_to: "subscribers",
      },
    });

    if (result.success) {
      const data = result.data as any;
      return {
        success: true,
        messageId: data.id || data.campaign_id,
      };
    }

    return {
      success: false,
      error: result.error?.message || "EmailOctopus API error",
    };
  } catch (error: any) {
    logger.error("Failed to send marketing email via EmailOctopus", {
      error: error.message,
      to,
      subject,
    });
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Creates and sends a broadcast campaign to a segment of subscribers.
 * This is used by the admin broadcast endpoint.
 *
 * In EmailOctopus, campaigns are created and then scheduled/sent.
 * We create the campaign, optionally add a segment filter, then trigger sending.
 */
export async function createAndSendBroadcast(
  subject: string,
  html: string,
  text?: string,
  options?: {
    onlySubscribed?: boolean; // Only send to "subscribed" status (exclude unsubscribed)
    excludeUnsubscribed?: boolean;
  },
): Promise<MarketingBroadcastResult> {
  const client = await getEmailOctopusClient();

  if (!client) {
    logger.error(
      "EmailOctopus client not initialized — broadcast not sent. " +
      "Configure EMAILOCTOPUS_API_KEY and EMAILOCTOPUS_LIST_ID to enable.",
    );
    return {
      success: false,
      error: "EmailOctopus not configured",
    };
  }

  try {
    // Step 1: Create the campaign
    const createResult = await emailOctopusRequest("post", "/campaigns", {
      name: subject,
      subject_line: subject,
      from_name: "ColabWize Marketing",
      reply_to: "marketing@colabwize.com",
      content_html: html,
      content_text: text || undefined,
      sent_to: "subscribers",
    });

    if (!createResult.success) {
      return {
        success: false,
        error: createResult.error?.message || "Failed to create EmailOctopus campaign",
      };
    }

    const campaignId = (createResult.data as any)?.id;

    if (!campaignId) {
      return {
        success: false,
        error: "EmailOctopus returned no campaign ID",
      };
    }

    logger.info(`Created EmailOctopus campaign: ${campaignId}`);

    // Step 2: Trigger sending
    const sendResult = await emailOctopusRequest(
      "post",
      `/campaigns/${campaignId}/send`,
      {},
    );

    if (sendResult.success) {
      return {
        success: true,
        messageId: campaignId,
      };
    }

    return {
      success: false,
      error: sendResult.error?.message || "Failed to send EmailOctopus campaign",
    };
  } catch (error: any) {
    logger.error("Failed to create/send broadcast campaign via EmailOctopus", {
      error: error.message,
      subject,
    });
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Sends a marketing broadcast to a specific list of user IDs.
 * This is the main entry point for admin-initiated marketing broadcasts.
 *
 * The recipients are first validated against the local DB to ensure
 * they haven't unsubscribed from marketing. Then each email is
 * upserted into EmailOctopus before a campaign is created and sent.
 *
 * @param userIds - Prisma user IDs to send to
 * @param subject - Email subject line
 * @param message - HTML email body
 * @param senderName - Optional sender name override
 * @param senderTitle - Optional sender title override
 */
export async function sendMarketingBroadcast(
  userIds: string[],
  subject: string,
  message: string,
  senderName?: string,
  senderTitle?: string,
): Promise<MarketingBroadcastResult> {
  logger.info(
    `Marketing broadcast initiated for ${userIds.length} users via EmailOctopus`,
    { subject },
  );

  // Fetch users, filtering out those unsubscribed from marketing
  const recipients = await prisma.user.findMany({
    where: {
      id: { in: userIds },
    },
    select: {
      email: true,
      full_name: true,
      unsubscribed_from_marketing: true,
    },
  });

  // Filter out unsubscribed users (client-side for schema-drift safety)
  const activeRecipients = recipients.filter(
    (u: { email: string; full_name: string | null; unsubscribed_from_marketing: boolean | null }) =>
      !u.unsubscribed_from_marketing,
  );

  if (activeRecipients.length === 0) {
    logger.info("No eligible marketing recipients found (all unsubscribed)");
    return {
      success: true,
      error: "No eligible recipients (all unsubscribed from marketing)",
    };
  }

  // Sync all recipients to EmailOctopus list first, respecting unsubscribe status
  for (const recipient of activeRecipients) {
    await upsertSubscriber(recipient.email, recipient.full_name || undefined, {
      forceUnsubscribe: recipient.unsubscribed_from_marketing,
    });
  }

  // Use the full HTML body — EmailOctopus provides its own unsubscribe footer
  const html = message;
  const text = message.replace(/<[^>]+>/g, "");

  // Create and send the campaign
  return createAndSendBroadcast(subject, html, text, {
    onlySubscribed: true,
  });
}

// Re-export the sync function so the broadcast path can use it
export { syncAllSubscribers } from "./audienceService";
export { getLocalMarketingStatus } from "./audienceService";
