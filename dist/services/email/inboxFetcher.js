"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processIncomingSupportEmails = processIncomingSupportEmails;
const imapflow_1 = require("imapflow");
const mailparser_1 = require("mailparser");
const isomorphic_dompurify_1 = __importDefault(require("isomorphic-dompurify"));
const logger_1 = __importDefault(require("../../monitoring/logger"));
const secrets_service_1 = __importDefault(require("../secrets-service"));
const prisma_async_1 = require("../../lib/prisma-async");
/**
 * Categorize email based on keywords in subject or body
 */
function categorizeEmail(subject, body) {
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
async function processIncomingSupportEmails() {
    // ... (previous lines)
    const imapUser = await secrets_service_1.default.getSecret("IMAP_USER") || "clawncore@colabwize.com";
    const imapPass = await secrets_service_1.default.getSecret("IMAP_PASSWORD");
    const imapHost = await secrets_service_1.default.getSecret("IMAP_HOST") || "imap.titan.email";
    const imapPort = await secrets_service_1.default.getSecret("IMAP_PORT") || "993";
    if (!imapPass) {
        logger_1.default.warn("[InboxFetcher] IMAP_PASSWORD not configured (env or vault). Skipping email fetch.");
        return;
    }
    logger_1.default.info(`[InboxFetcher] Starting sync attempt for ${imapUser} on ${imapHost}...`);
    const client = new imapflow_1.ImapFlow({
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
        logger_1.default.error(`[InboxFetcher] IMAP Client Error: ${err.message}`, { error: err });
    });
    const prisma = await (0, prisma_async_1.initializePrisma)();
    let lastUid = 0;
    const lastMessage = await prisma.supportMessage.findFirst({
        orderBy: { imap_uid: 'desc' },
        select: { imap_uid: true }
    });
    if (lastMessage)
        lastUid = lastMessage.imap_uid;
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
                if (!message.source)
                    continue;
                const existing = await prisma.supportMessage.findUnique({ where: { imap_uid: uid } });
                if (existing)
                    continue;
                const parsed = await (0, mailparser_1.simpleParser)(message.source);
                const senderEmail = parsed.from?.value[0]?.address || "unknown@unknown.com";
                const subject = parsed.subject || "(No Subject)";
                const html = parsed.html || parsed.textAsHtml || "";
                const text = parsed.text || "";
                const sanitizedHtml = isomorphic_dompurify_1.default.sanitize(html);
                const { folder, priority } = categorizeEmail(subject, text);
                let threadId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).substring(7);
                const cleanSubject = subject.replace(/^Re:\s+/i, "").trim();
                if (subject.toLowerCase().startsWith("re:")) {
                    const previousMessage = await prisma.supportMessage.findFirst({
                        where: { sender_email: senderEmail, subject: { contains: cleanSubject } },
                        orderBy: { received_at: "desc" }
                    });
                    if (previousMessage)
                        threadId = previousMessage.thread_id;
                }
                await prisma.supportMessage.create({
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
                logger_1.default.info(`[InboxFetcher] Processed email from ${senderEmail} (UID: ${uid}) -> Folder: ${folder}`);
                processedCount++;
            }
            if (processedCount > 0) {
                logger_1.default.info(`[InboxFetcher] Finished sync. Processed ${processedCount} new messages.`);
            }
            else {
                logger_1.default.debug("[InboxFetcher] Sync finished. No new messages found.");
            }
        }
        finally {
            lock.release();
        }
        await client.logout();
    }
    catch (err) {
        logger_1.default.error("[InboxFetcher] Error during IMAP fetch:", {
            message: err.message,
            stack: err.stack
        });
    }
}
