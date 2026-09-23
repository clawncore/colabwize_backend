/**
 * Campaign Service — EmailOctopus Campaign Management
 *
 * Provides higher-level campaign operations for marketing emails.
 * All operations require the EmailOctopus API key and list ID to be configured.
 */

import logger from "../../monitoring/logger";
import {
  emailOctopusRequest,
  getEmailOctopusListId,
  EmailOctopusResult,
} from "./emailOctopusClient";

export interface Campaign {
  id: string;
  name: string;
  subject_line: string;
  from_name: string;
  reply_to: string;
  status: string;
  created_at: string;
  sent_at?: string;
  preview_url?: string;
  web_url?: string;
}

export interface CampaignStats {
  dispatched: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complaint: number;
  undeliverable: number;
  unique_views: number;
  unique_clicks: number;
}

/**
 * Creates a new draft campaign in EmailOctopus.
 * The campaign is created but not sent — use sendCampaign() to dispatch.
 */
export async function createCampaign(
  subject: string,
  html: string,
  text?: string,
  fromName: string = "ColabWize Marketing",
  replyTo: string = "marketing@colabwize.com",
): Promise<EmailOctopusResult> {
  const listId = getEmailOctopusListId();
  if (!listId) {
    return {
      success: false,
      error: new Error("EmailOctopus list ID not configured"),
    };
  }

  return emailOctopusRequest("post", "/campaigns", {
    name: subject,
    subject_line: subject,
    from_name: fromName,
    reply_to: replyTo,
    content_html: html,
    content_text: text,
    sent_to: "subscribers",
    list_id: listId,
  });
}

/**
 * Sends a draft campaign immediately.
 */
export async function sendCampaign(
  campaignId: string,
): Promise<EmailOctopusResult> {
  return emailOctopusRequest("post", `/campaigns/${campaignId}/send`, {});
}

/**
 * Lists campaigns with optional filtering.
 */
export async function listCampaigns(
  limit: number = 50,
  offset: number = 0,
): Promise<EmailOctopusResult> {
  return emailOctopusRequest("get", `/campaigns?limit=${limit}&offset=${offset}`);
}

/**
 * Gets details for a specific campaign.
 */
export async function getCampaign(campaignId: string): Promise<EmailOctopusResult> {
  return emailOctopusRequest("get", `/campaigns/${campaignId}`);
}

/**
 * Gets delivery stats for a specific campaign.
 */
export async function getCampaignStats(
  campaignId: string,
): Promise<EmailOctopusResult> {
  return emailOctopusRequest(
    "get",
    `/campaigns/${campaignId}/stats`,
  );
}

/**
 * Deletes a campaign (only works for draft campaigns).
 */
export async function deleteCampaign(
  campaignId: string,
): Promise<EmailOctopusResult> {
  return emailOctopusRequest("delete", `/campaigns/${campaignId}`);
}

/**
 * Creates and sends a campaign in one operation.
 * This is the main entry point for programmatic campaign sends.
 */
export async function createAndSendCampaign(
  subject: string,
  html: string,
  text?: string,
): Promise<EmailOctopusResult> {
  const listId = getEmailOctopusListId();
  if (!listId) {
    return {
      success: false,
      error: new Error("EmailOctopus list ID not configured"),
    };
  }

  // Step 1: Create campaign
  const createResult = await emailOctopusRequest("post", "/campaigns", {
    name: subject,
    subject_line: subject,
    from_name: "ColabWize Marketing",
    reply_to: "marketing@colabwize.com",
    content_html: html,
    content_text: text || undefined,
    sent_to: "subscribers",
    list_id: listId,
  });

  if (!createResult.success) {
    return createResult;
  }

  const campaignId = (createResult.data as any)?.id;

  if (!campaignId) {
    return {
      success: false,
      error: new Error("EmailOctopus campaign creation returned no ID"),
    };
  }

  logger.info(`Created EmailOctopus campaign: ${campaignId}`);

  // Step 2: Send campaign
  return sendCampaign(campaignId);
}
