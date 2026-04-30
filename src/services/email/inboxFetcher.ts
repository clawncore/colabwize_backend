import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import DOMPurify from "isomorphic-dompurify";
import logger from "../../monitoring/logger";
import SecretsService from "../secrets-service";
import { initializePrisma } from "../../lib/prisma-async";

/**
 * Categorize email based on keywords in subject or body
 */
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
        const { folder, priority } = categorizeEmail(subject, text);

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
<<<<<<< HEAD
        logger.info(`[InboxFetcher] Finished sync. Processed ${processedCount} new messages (out of ${totalFound} total checked).`);
      } else {
        logger.debug(`[InboxFetcher] Sync finished. Checked ${totalFound} messages, no new ones found.`);
=======
        logger.info(`[InboxFetcher] Finished sync. Processed ${processedCount} new messages.`);
      } else {
        logger.debug("[InboxFetcher] Sync finished. No new messages found.");
>>>>>>> d14d7db (Syncing backend with Main)
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
