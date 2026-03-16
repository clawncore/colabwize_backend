import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { PrismaClient } from "@prisma/client";
import DOMPurify from "isomorphic-dompurify";
import dotenv from "dotenv";

dotenv.config();

const prisma = new PrismaClient();

export async function processIncomingSupportEmails() {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || "imap.titan.email",
    port: parseInt(process.env.IMAP_PORT || "993"),
    secure: true,
    auth: {
      user: process.env.IMAP_USER || "clawncore@colabwize.com",
      pass: process.env.IMAP_PASSWORD || "",
    },
    logger: false,
  });

  try {
    await client.connect();
    let lock = await client.getMailboxLock("INBOX");

    try {
      // Search for unread messages
      const messages = client.fetch({ seen: false }, {
        uid: true,
        envelope: true,
        source: true,
        bodyStructure: true,
      });

      for await (const message of messages) {
        const uid = message.uid;
        if (!message.source) continue;

        // Check if already processed
        const existing = await (prisma as any).supportMessage.findUnique({
          where: { imap_uid: uid },
        });

        if (existing) continue;

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
        console.log(`[InboxFetcher] Processed email from ${senderEmail} (UID: ${uid})`);
      }
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    console.error("[InboxFetcher] Error during IMAP fetch:", err);
  }
}
