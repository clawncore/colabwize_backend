import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import DOMPurify from "isomorphic-dompurify";
import logger from "../../monitoring/logger";
import SecretsService from "../secrets-service";
import { initializePrisma } from "../../lib/prisma-async";

export async function processIncomingSupportEmails() {
  // Retrieve credentials from environment or Supabase Vault
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
    logger: console,
  });

  const prisma = await initializePrisma();

  try {
    await client.connect();
    logger.info(`[InboxFetcher] Connected to ${imapHost}.`);

    let lock = await client.getMailboxLock("INBOX");
    try {
      // Search for unread messages
      const messages = client.fetch({ seen: false }, {
        uid: true,
        envelope: true,
        source: true,
        bodyStructure: true,
      });

      let processedCount = 0;
      for await (const message of messages) {
        const uid = message.uid;
        if (!message.source) continue;

        // Check if already processed
        const existing = await (prisma as any).supportMessage.findUnique({
          where: { imap_uid: uid },
        });

        if (existing) {
            logger.debug(`[InboxFetcher] Message UID ${uid} already exists, skipping.`);
            continue;
        }

        // Parse message
        const parsed = await simpleParser(message.source);
        const senderEmail = parsed.from?.value[0]?.address || "unknown@unknown.com";
        const subject = parsed.subject || "(No Subject)";
        const html = parsed.html || parsed.textAsHtml || "";
        const text = parsed.text || "";
        
        // Sanitize
        const sanitizedHtml = DOMPurify.sanitize(html as string);

        // Detect source alias (help@, support@, etc.)
        const toHeader: any = parsed.to;
        let sourceAlias = "support@colabwize.com";
        if (Array.isArray(toHeader)) {
            const aliasMatch = toHeader.find((t: any) => t.value.some((v: any) => v.address?.includes("@colabwize.com")));
            if (aliasMatch) sourceAlias = aliasMatch.value[0].address || sourceAlias;
        }

        // Threading Logic
        let threadId = (globalThis as any).crypto?.randomUUID?.() || Math.random().toString(36).substring(7);
        const cleanSubject = subject.replace(/^Re:\s+/i, "").trim();
        
        if (subject.toLowerCase().startsWith("re:")) {
            const previousMessage = await (prisma as any).supportMessage.findFirst({
                where: {
                    sender_email: senderEmail,
                    subject: {
                        contains: cleanSubject
                    }
                },
                orderBy: { received_at: "desc" }
            });

            if (previousMessage) {
                threadId = previousMessage.thread_id;
            }
        }

        // Store message
        await (prisma as any).supportMessage.create({
          data: {
            sender_email: senderEmail,
            subject: subject,
            message_text: text,
            message_html: sanitizedHtml,
            received_at: parsed.date || new Date(),
            status: "open",
            thread_id: threadId,
            source_alias: sourceAlias,
            imap_uid: uid,
          },
        });

        // Mark as seen
        await client.messageFlagsAdd({ uid }, ["\\Seen"]);
        logger.info(`[InboxFetcher] Processed email from ${senderEmail} (UID: ${uid})`);
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
