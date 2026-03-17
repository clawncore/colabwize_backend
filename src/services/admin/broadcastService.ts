import { prisma } from "../../lib/prisma";
import { sendEmail } from "../email/baseMailer";
import { EmailSender } from "../email/emailConfig";
import logger from "../../monitoring/logger";

interface BroadcastOptions {
  userIds: string[];
  senderAlias: EmailSender;
  subject: string;
  message: string;
}

/**
 * Broadcasts emails in batches to respect rate limits (50/sec)
 * and prevent blocking the main event loop.
 */
export const processBroadcast = async (options: BroadcastOptions) => {
  const { userIds, senderAlias, subject, message } = options;
  const BATCH_SIZE = 50;
  const DELAY_MS = 1000; // 1 second between batches

  logger.info(`Starting broadcast to ${userIds.length} recipients...`);

  // Fetch candidate emails to avoid multiple circular queries
  const recipients = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { email: true }
  });

  let successCount = 0;
  let failureCount = 0;

  const fallbackText = message.replace(/<[^>]+>/g, '');

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    
    // Process batch in parallel
    const sendPromises = batch.map(async (user: { email: string }) => {
      try {
        const result = await sendEmail({
          from: senderAlias,
          to: user.email,
          subject,
          html: message,
          text: fallbackText
        });

        // Log to DB
        await prisma.emailLog.create({
          data: {
            recipient: user.email,
            sender: senderAlias,
            subject,
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
