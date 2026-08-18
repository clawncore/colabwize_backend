import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import DOMPurify from "isomorphic-dompurify";
import logger from "../../monitoring/logger";
import SecretsService from "../secrets-service";
import { initializePrisma } from "../../lib/prisma-async";

/**
 * Categorize email based on keywords in subject or body
 */
<<<<<<< HEAD
function categorizeEmail(subject: string, body: string): { folder: string; priority: string } {
  const content = (subject + " " + body).toLowerCase();

  if (/billing|invoice|payment|subscription|refund|charge|receipt|premium|plan/i.test(content)) {
    return { folder: "Billing", priority: "high" };
  }

  if (/security|password|login|auth|hacked|verify|2fa|suspicious|unauthorized|breach/i.test(content)) {
    return { folder: "Security", priority: "high" };
  }

  if (/contact|hello|inquiry|question|help|request/i.test(content)) {
    return { folder: "Contact", priority: "medium" };
  }

  if (/system|update|maintenance|feature|feedback|platform|error|bug/i.test(content)) {
    return { folder: "Platform", priority: "medium" };
  }

=======
function categorizeEmail(subject: string, body: string, senderEmail: string): { folder: string; priority: string } {
  const sub = subject.toLowerCase();
  const content = (subject + " " + body).toLowerCase();
  const sender = senderEmail.toLowerCase();

  // Spam — obvious junk first (override everything else)
  if (/unsubscribe|opt.out|click.here|act.now|limited.time|congratulations.*won|you.*won|free.*prize|claim.*reward|viagra|cialis|casino|lottery|winner|nigerian|prince|inheritance|crypto.*invest|make.*money.*fast|work.from.home.*\$|dear.*friend|beloved|urgent.*business|million.*dollars|bank.*transfer|atm.*card|pharmacy|pills|supplement|enlargement|weight.loss|miracle|cure|remedy|treatment|diagnosis|doctor|prescription|buy.*now|order.*now|limited.*offer|special.*promotion|exclusive.*deal|free.*trial|risk.free|money.back|guarantee|satisfaction|best.price|lowest.price|save.*percent|discount.*code|coupon.*code|promo.*code/i.test(content)) {
    return { folder: "Spam", priority: "low" };
  }

  // Spam — suspicious sender patterns
  if (/^(no[-_.]?reply|noreply|mailer[-_.]?daemon|postmaster)@/i.test(sender) && !/colabwize/i.test(sender)) {
    return { folder: "Spam", priority: "low" };
  }
  // Spam — known junk domains
  if (/\.(top|xyz|club|buzz|gq|cf|ml|tk|click|link|download|stream|racing|win|party|ru|cn|biz|info|pro|icu)$/i.test(sender)) {
    return { folder: "Spam", priority: "low" };
  }

  // Billing — require subject match OR strong body indicators
  const billingSub = /billing|invoice|payment|subscription|refund|charge|receipt|premium\s*plan|upgrade|downgrade|cancel\s*subscription|pricing|coupon|discount/i.test(sub);
  const billingBody = /billing|invoice|payment|subscription|refund|charge|receipt/i.test(content);
  const billingStrong = /refund|cancel.*subscription|charge.*twice|double.*charge|overcharged|payment.*failed|billing.*issue/i.test(content);
  if (billingSub || billingStrong || (billingBody && /billing|invoice|refund/i.test(content))) {
    return { folder: "Billing", priority: "high" };
  }

  // Security — require subject match OR strong body indicators
  const securitySub = /security|password|login|auth|hacked|verify|2fa|suspicious|unauthorized|breach/i.test(sub);
  const securityStrong = /cannot.*log.*in|locked.*out|account.*compromised|unauthorized.*access|password.*reset|two.?factor/i.test(content);
  if (securitySub || securityStrong) {
    return { folder: "Security", priority: "high" };
  }

  // Platform — only if subject clearly indicates
  const platformSub = /bug|error|crash|not\s*working|broken|feature\s*request|maintenance|downtime/i.test(sub);
  if (platformSub) {
    return { folder: "Platform", priority: "medium" };
  }

  // Contact — only if subject is clearly a greeting/inquiry
  const contactSub = /^(hello|hi|hey|greetings|contact|inquiry|question|feedback)/i.test(sub);
  if (contactSub) {
    return { folder: "Contact", priority: "medium" };
  }

  // Default — Support (most emails should land here)
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
  return { folder: "Support", priority: "medium" };
}

export async function processIncomingSupportEmails() {
  // ... (previous lines)
  const imapUser = await SecretsService.getSecret("IMAP_USER") || "clawncore@colabwize.com";
  const imapPass = await SecretsService.getSecret("IMAP_PASSWORD");
  const imapHost = await SecretsService.getSecret("IMAP_HOST") || "imap.titan.email";
  const imapPort = await SecretsService.getSecret("IMAP_PORT") || "993";

  if (!imapPass) {
    logger.warn("[InboxFetcher] IMAP_PASSWORD not configured (env or vault). Skipping email fetch.");
    return;
  }

  logger.info(`[InboxFetcher] Starting sync attempt for ${imapUser} on ${imapHost}...`);

  const client = new ImapFlow({
    host: imapHost,
    port: parseInt(imapPort),
    secure: true,
    auth: {
      user: imapUser,
      pass: imapPass,
    },
    logger: false,
    tls: { rejectUnauthorized: false },
    connectionTimeout: 30000,
    greetingTimeout: 30000,
  });

  client.on("error", (err) => {
    logger.error(`[InboxFetcher] IMAP Client Error: ${err.message}`, { error: err });
  });

  const prisma = await initializePrisma();

  let lastUid = 0;
  const lastMessage = await (prisma as any).supportMessage.findFirst({
    orderBy: { imap_uid: 'desc' },
    select: { imap_uid: true }
  });
  if (lastMessage) lastUid = lastMessage.imap_uid;

  try {
    await client.connect();
    let lock = await client.getMailboxLock("INBOX");
    try {
      const fetchRange = lastUid > 0 ? `${lastUid + 1}:*` : {};
      const messages = client.fetch(fetchRange, { uid: true, envelope: true, source: true });

      let totalFound = 0;
      let processedCount = 0;
      for await (const message of messages) {
        totalFound++;
        const uid = message.uid;
        if (!message.source) continue;

        const existing = await (prisma as any).supportMessage.findUnique({ where: { imap_uid: uid } });
        if (existing) continue;

        const parsed = await simpleParser(message.source);
        const senderEmail = parsed.from?.value[0]?.address || "unknown@unknown.com";
        const subject = parsed.subject || "(No Subject)";
        const html = parsed.html || parsed.textAsHtml || "";
        const text = parsed.text || "";

        const sanitizedHtml = DOMPurify.sanitize(html as string);
<<<<<<< HEAD
        const { folder, priority } = categorizeEmail(subject, text);
=======
        const { folder, priority } = categorizeEmail(subject, text, senderEmail);
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b

        let threadId = (globalThis as any).crypto?.randomUUID?.() || Math.random().toString(36).substring(7);
        const cleanSubject = subject.replace(/^Re:\s+/i, "").trim();

        if (subject.toLowerCase().startsWith("re:")) {
          const previousMessage = await (prisma as any).supportMessage.findFirst({
            where: { sender_email: senderEmail, subject: { contains: cleanSubject } },
            orderBy: { received_at: "desc" }
          });
          if (previousMessage) threadId = previousMessage.thread_id;
        }

        await (prisma as any).supportMessage.create({
          data: {
            sender_email: senderEmail,
            subject: subject,
            message_text: text,
            message_html: sanitizedHtml,
            received_at: parsed.date || new Date(),
            status: "open",
            thread_id: threadId,
            source_alias: imapUser,
            imap_uid: uid,
            priority: priority,
            is_read: false,
            folder: folder
          },
        });

        // Mark as seen on server
        await client.messageFlagsAdd({ uid }, ["\\Seen"]);
        logger.info(`[InboxFetcher] Processed email from ${senderEmail} (UID: ${uid}) -> Folder: ${folder}`);
        processedCount++;
      }

      if (processedCount > 0) {
        logger.info(`[InboxFetcher] Finished sync. Processed ${processedCount} new messages.`);
      } else {
        logger.debug("[InboxFetcher] Sync finished. No new messages found.");
      }

    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err: any) {
    logger.error("[InboxFetcher] Error during IMAP fetch:", {
      message: err.message,
      stack: err.stack
    });
  }
}
<<<<<<< HEAD
=======

/**
 * One-time recategorization of existing support messages using updated categorizeEmail logic.
 */
export async function recategorizeExistingMessages() {
  const prisma = await initializePrisma();
  const messages = await (prisma as any).supportMessage.findMany({
    select: { id: true, subject: true, message_text: true, sender_email: true, folder: true },
  });

  let updated = 0;
  for (const msg of messages) {
    const { folder } = categorizeEmail(msg.subject, msg.message_text || "", msg.sender_email);
    if (folder !== msg.folder) {
      await (prisma as any).supportMessage.update({
        where: { id: msg.id },
        data: { folder },
      });
      updated++;
    }
  }
  logger.info(`[InboxFetcher] Recategorized ${updated}/${messages.length} messages.`);
  return { total: messages.length, updated };
}
>>>>>>> 07fc7c4c7cf442949e68299453cab1f75a47316b
