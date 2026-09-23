import { prisma } from "../../lib/prisma";
import { sendEmail } from "../../services/email/baseMailer";
import { EmailSender } from "../../services/email/emailConfig";
import { buildEmailSignature, buildEmailHeader } from "../../services/email/emailSignatures";
import { wrapInPremiumLayout } from "../../services/email/emailLayout";
import { sendMarketingBroadcast } from "../../services/marketing/marketingService";
import { getLocalMarketingStatus } from "../../services/marketing/audienceService";
import logger from "../../monitoring/logger";

interface BroadcastOptions {
  userIds: string[];
  senderAlias: EmailSender;
  subject: string;
  message: string;
  senderName?: string;
  senderTitle?: string;
  fromAddress?: string; // the resolved "from" email, stored on each log row
}

/**
 * Checks if a given sender alias is a marketing alias that should be
 * routed to EmailOctopus instead of Resend.
 *
 * Marketing aliases: MARKETING only.
 * All other aliases (WELCOME, VERIFY, SECURITY, NOTIFICATIONS, BILLING,
 * HELP, SUPPORT, TEAM, INFO, PRESS, LEGAL, ENGINEERING) route to Resend.
 */
function isMarketingAlias(alias: EmailSender): boolean {
  return alias === "MARKETING";
}

/**
 * Broadcasts emails in batches to respect rate limits (50/sec)
 * and prevent blocking the main event loop.
 * Uses createMany for batch inserts to avoid N+1 queries.
 *
 * Provider routing:
 * - MARKETING alias → EmailOctopus (marketing campaigns)
 * - All other aliases → Resend (transactional/security/billing)
 */
export const processBroadcast = async (options: BroadcastOptions) => {
  const { userIds, senderAlias, subject, message, senderName, senderTitle, fromAddress } = options;

  // ── Marketing broadcasts route to EmailOctopus ──────────────────────
  if (isMarketingAlias(senderAlias)) {
    logger.info(`Routing broadcast to EmailOctopus (marketing alias: ${senderAlias})`);
    const result = await sendMarketingBroadcast(
      userIds,
      subject,
      message,
      senderName,
      senderTitle,
    );

    if (result.success || result.error?.includes("unsubscribed")) {
      // Marketing sends via EmailOctopus don't log to EmailLog the same way.
      // EmailOctopus provides its own analytics/tracking.
      logger.info(`Marketing broadcast via EmailOctopus: ${result.messageId || "no messageId"}`);
    } else {
      logger.error(`Marketing broadcast failed: ${result.error}`);
    }

    return;
  }

  // ── Transactional broadcasts route to Resend ───────────────────────
  logger.info(`Routing broadcast to Resend (alias: ${senderAlias})`);

  const BATCH_SIZE = 50;
  const DELAY_MS = 1000; // 1 second between batches

  // Limit maximum recipients to prevent abuse
  const maxRecipients = Math.min(userIds.length, 10000);
  const limitedUserIds = userIds.slice(0, maxRecipients);

  if (userIds.length > maxRecipients) {
    logger.warn(`Broadcast limited to ${maxRecipients} recipients (requested: ${userIds.length})`);
  }

  logger.info(`Starting broadcast to ${limitedUserIds.length} recipients...`);

  // Fetch candidate emails — filter out marketing-unsubscribed users
  // only when the alias is one that recipients could unsubscribe from.
  // For transactional aliases (SECURITY, BILLING, etc.), we still send
  // even if they've unsubscribed from marketing.
  const recipients = await prisma.user.findMany({
    where: {
      id: { in: limitedUserIds },
      ...(isMarketingAlias(senderAlias)
        ? { unsubscribed_from_marketing: false }
        : {}),
    },
    select: { email: true, full_name: true }
  });

  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);

    const sendPromises = batch.map(async (user: { email: string; full_name: string | null }) => {
      try {
        const userName = user.full_name || "there";
        const unsubscribeLink = `https://colabwize.com/unsubscribe?email=${encodeURIComponent(user.email)}`;

        // Personalize message and subject
        const personalizedMessage = message.replace(/{{name}}|{{full_name}}/g, userName);
        const personalizedSubject = subject.replace(/{{name}}|{{full_name}}/g, userName);

        const finalHtml = wrapInPremiumLayout(personalizedMessage, senderAlias, senderName, senderTitle, user.email);
        const fallbackText = personalizedMessage.replace(/<[^>]+>/g, '');

        const result = await sendEmail({
          from: senderAlias,
          to: user.email,
          subject: personalizedSubject,
          html: finalHtml,
          text: fallbackText
        });

        // Email is automatically logged by baseMailer.sendEmail()

        if (result.success) successCount++;
        else failureCount++;

      } catch (err: any) {
        failureCount++;
        logger.error(`Broadcast item failed for ${user.email}:`, err);
      }
    });

    await Promise.all(sendPromises);

    // Wait before next batch if not last
    if (i + BATCH_SIZE < recipients.length) {
      await new Promise(resolve => setTimeout(resolve, DELAY_MS));
    }
  }

  logger.info(`Broadcast complete. Success: ${successCount}, Failures: ${failureCount}`);
};
