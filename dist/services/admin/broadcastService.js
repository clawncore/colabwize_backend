"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processBroadcast = void 0;
const prisma_1 = require("../../lib/prisma");
const baseMailer_1 = require("../email/baseMailer");
const emailLayout_1 = require("../email/emailLayout");
const logger_1 = __importDefault(require("../../monitoring/logger"));
/**
 * Broadcasts emails in batches to respect rate limits (50/sec)
 * and prevent blocking the main event loop.
 */
const processBroadcast = async (options) => {
    const { userIds, senderAlias, subject, message, senderName, senderTitle, fromAddress } = options;
    const BATCH_SIZE = 50;
    const DELAY_MS = 1000; // 1 second between batches
    logger_1.default.info(`Starting broadcast to ${userIds.length} recipients...`);
    // Fetch candidate emails to avoid multiple circular queries
    // STRICTLY filter out users who have opted out of marketing
    const recipients = await prisma_1.prisma.user.findMany({
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
        const sendPromises = batch.map(async (user) => {
            try {
                const userName = user.full_name || "there";
                const unsubscribeLink = `https://colabwize.com/unsubscribe?email=${encodeURIComponent(user.email)}`;
                // Personalize message and subject
                const personalizedMessage = message.replace(/{{name}}|{{full_name}}/g, userName);
                const personalizedSubject = subject.replace(/{{name}}|{{full_name}}/g, userName);
                const finalHtml = (0, emailLayout_1.wrapInPremiumLayout)(personalizedMessage, senderAlias, senderName, senderTitle, user.email);
                const fallbackText = personalizedMessage.replace(/<[^>]+>/g, '');
                const result = await (0, baseMailer_1.sendEmail)({
                    from: senderAlias,
                    to: user.email,
                    subject: personalizedSubject,
                    html: finalHtml,
                    text: fallbackText
                });
                // Log to DB — store the broadcast template body + the real from
                // address so the admin Sentbox shows exactly what was sent.
                await prisma_1.prisma.emailLog.create({
                    data: {
                        recipient: user.email,
                        sender: senderAlias,
                        from_address: fromAddress || undefined,
                        subject: personalizedSubject,
                        status: result.success ? "sent" : "failed",
                        error: result.success ? null : (result.error || "Unknown error"),
                        message_body: personalizedMessage,
                    }
                });
                if (result.success)
                    successCount++;
                else
                    failureCount++;
            }
            catch (err) {
                failureCount++;
                logger_1.default.error(`Broadcast item failed for ${user.email}:`, err);
            }
        });
        await Promise.all(sendPromises);
        // Wait before next batch if not last
        if (i + BATCH_SIZE < recipients.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
    }
    logger_1.default.info(`Broadcast complete. Success: ${successCount}, Failures: ${failureCount}`);
};
exports.processBroadcast = processBroadcast;
