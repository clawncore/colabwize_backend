import logger from "../../monitoring/logger";
import { prisma } from "../../lib/prisma";
import {
  getEmailOctopusClient,
  emailOctopusRequest,
  getEmailOctopusListId,
  EmailOctopusResult,
} from "./emailOctopusClient";

export interface SubscriberResult {
  success: boolean;
  subscriberId?: string;
  status: "subscribed" | "unsubscribed" | "pending" | "unknown";
  error?: Error;
}

export interface SyncResult {
  added: number;
  updated: number;
  failed: number;
  errors: string[];
}

/**
 * Checks whether EmailOctopus is configured and ready for use.
 */
export function isEmailOctopusConfigured(): boolean {
  return getEmailOctopusListId() !== null;
}

/**
 * Adds or updates a subscriber in the EmailOctopus list.
 * If the email is marked as unsubscribed in the local DB, the subscriber
 * status is set to "unsubscribed" in EmailOctopus as well, ensuring
 * consistency across both systems.
 *
 * This is the authoritative sync point for marketing subscriptions.
 */
export async function upsertSubscriber(
  email: string,
  fullName?: string,
  opts?: { forceUnsubscribe?: boolean },
): Promise<SubscriberResult> {
  const client = await getEmailOctopusClient();

  if (!client) {
    return {
      success: false,
      status: "unknown",
      error: new Error("EmailOctopus client not initialized"),
    };
  }

  // Check local DB for the source-of-truth unsubscribe flag
  const localStatus = opts?.forceUnsubscribe
    ? "unsubscribed"
    : await getLocalMarketingStatus(email);

  try {
    // EmailOctopus v2: POST /lists/{listId}/contacts
    const payload: any = {
      email: email,
      status: localStatus === "unsubscribed" ? "unsubscribed" : "subscribed",
    };

    if (fullName) {
      payload.fields = {
        NAME: fullName,
      };
    }

    const listId = getEmailOctopusListId();
    if (!listId) {
      return {
        success: false,
        status: localStatus as any,
        error: new Error("EmailOctopus list ID not configured"),
      };
    }

    const result = await emailOctopusRequest(
      "post",
      `/lists/${listId}/contacts`,
      payload,
    );

    if (!result.success) {
      return {
        success: false,
        status: localStatus as any,
        error: result.error,
      };
    }

    const data = result.data as any;

    // EmailOctopus returns existing contacts with id and status
    return {
      success: true,
      subscriberId: data.id || data.subscribe?.id,
      status: (data.status || data.subscribe?.status || localStatus) as any,
    };
  } catch (error: any) {
    logger.error(`Failed to upsert subscriber ${email} in EmailOctopus`, {
      error: error.message,
    });
    return {
      success: false,
      status: localStatus as any,
      error: error,
    };
  }
}

/**
 * Reads the local `unsubscribed_from_marketing` flag from the User model.
 * This is the authoritative source — if the schema is not yet migrated,
 * this returns a safe default of "subscribed" so we never accidentally
 * unsubscribe someone.
 */
export async function getLocalMarketingStatus(
  email: string,
): Promise<"subscribed" | "unsubscribed"> {
  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { unsubscribed_from_marketing: true },
    });

    // If the field doesn't exist in the schema yet, Prisma will throw.
    // Fall back to "subscribed" (safe default — we never want to
    // accidentally treat an active user as unsubscribed).
    if (!user) return "subscribed";

    return user.unsubscribed_from_marketing ? "unsubscribed" : "subscribed";
  } catch (error: any) {
    // Schema drift guard: if the field doesn't exist yet, log and default to subscribed
    logger.debug(
      "unsubscribed_from_marketing field not available in schema — defaulting to subscribed",
      { email, error: error.message },
    );
    return "subscribed";
  }
}

/**
 * Syncs all users who are subscribed to marketing emails into the EmailOctopus list.
 * This is typically run as a one-time migration or periodic reconciliation job.
 *
 * Respects the local `unsubscribed_from_marketing` flag — unsubscribed users
 * are synced but with status "unsubscribed" so EmailOctopus does not re-send.
 */
export async function syncAllSubscribers(): Promise<SyncResult> {
  const results: SyncResult = {
    added: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  const client = await getEmailOctopusClient();

  if (!client) {
    results.errors.push(
      "EmailOctopus client not initialized — sync skipped. " +
      "Configure EMAILOCTOPUS_API_KEY and EMAILOCTOPUS_LIST_ID to enable.",
    );
    return results;
  }

  // Fetch users in batches of 500
  const BATCH_SIZE = 500;
  let offset = 0;

  while (true) {
    const users = await prisma.user.findMany({
      where: {},
      select: {
        email: true,
        full_name: true,
        unsubscribed_from_marketing: true,
      },
      skip: offset,
      take: BATCH_SIZE,
    });

    if (users.length === 0) break;

    for (const user of users) {
      const result = await upsertSubscriber(
        user.email,
        user.full_name || undefined,
        {
          forceUnsubscribe: user.unsubscribed_from_marketing,
        },
      );

      if (result.success) {
        if (result.status === "subscribed") {
          results.added++;
        } else {
          results.updated++;
        }
      } else {
        results.failed++;
        results.errors.push(
          `${user.email}: ${result.error?.message || "unknown error"}`,
        );
      }
    }

    offset += BATCH_SIZE;
    logger.info(`Synced ${offset} users to EmailOctopus so far...`);
  }

  logger.info(
    `Audience sync complete. Added: ${results.added}, Updated: ${results.updated}, Failed: ${results.failed}`,
  );

  return results;
}

/**
 * Marks a subscriber as unsubscribed in EmailOctopus.
 * Called when a user unsubscribes via the unsubscribe page.
 */
export async function markSubscriberAsUnsubscribed(
  email: string,
): Promise<EmailOctopusResult> {
  const client = await getEmailOctopusClient();

  if (!client) {
    return {
      success: false,
      error: new Error("EmailOctopus client not initialized"),
    };
  }

  const listId = getEmailOctopusListId();
  if (!listId) {
    return {
      success: false,
      error: new Error("EmailOctopus list ID not configured"),
    };
  }

  // EmailOctopus v2: POST /lists/{listId}/contacts/{email}/unsubscribe
  const result = await emailOctopusRequest(
    "post",
    `/lists/${listId}/contacts/${encodeURIComponent(email)}/unsubscribe`,
    {},
  );

  if (result.success) {
    logger.info(`Marked subscriber as unsubscribed in EmailOctopus: ${email}`);
  }

  return result;
}
