import { prisma } from "../../lib/prisma";
import { sendEmail } from "../email/baseMailer";
import { EmailSender } from "../email/emailConfig";
import { buildEmailSignature, buildEmailHeader } from "../email/emailSignatures";
import { wrapInPremiumLayout } from "../email/emailLayout";
import logger from "../../monitoring/logger";

interface BroadcastOptions {
  userIds: string[];
  senderAlias: EmailSender;
  subject: string;
  message: string;
  senderName?: string;
  senderTitle?: string;
}

/**
 * Broadcasts emails in batches to respect rate limits (50/sec)
 * and prevent blocking the main event loop.
 */
export const processBroadcast = async (options: BroadcastOptions) => {
  const { userIds, senderAlias, subject, message, senderName, senderTitle } = options;
  const BATCH_SIZE = 50;
  const DELAY_MS = 1000; // 1 second between batches

  logger.info(`Starting broadcast to ${userIds.length} recipients...`);

  // Fetch candidate emails to avoid multiple circular queries
  // STRICTLY filter out users who have opted out of marketing
  const recipients = await prisma.user.findMany({
    where: { 
      id: { in: userIds },
      unsubscribed_from_marketing: false 
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

        // Log to DB
        await prisma.emailLog.create({
          data: {
            recipient: user.email,
            sender: senderAlias,
            subject: personalizedSubject,
            status: result.success ? "sent" : "failed",
            error: result.success ? null : (result.error || "Unknown error")
          }
        });

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
