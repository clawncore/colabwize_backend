"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
const logger_1 = __importDefault(require("../../monitoring/logger"));
const resendClient_1 = require("./resendClient");
const emailConfig_1 = require("./emailConfig");
/**
 * Base function to send an email using Resend with retry logic.
 * Centralizes common parameters like reply_to and handles errors.
 */
async function sendEmail({ from, to, subject, html, text, attachments, }) {
    const resend = await (0, resendClient_1.getResendClient)();
    if (!resend) {
        const errorMsg = "Resend client not initialized - cannot send email";
        logger_1.default.error(errorMsg);
        return { success: false, error: new Error(errorMsg) };
    }
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 1000; // 1 second
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            logger_1.default.info(`Attempt ${attempt}: Sending ${from} email to recipient`, {
                subject,
                timestamp: new Date().toISOString(),
            });
            const { data, error } = await resend.emails.send({
                from: emailConfig_1.SENDER_IDENTITIES[from],
                to,
                subject,
                html,
                text: text || "This email requires an HTML viewer.",
                attachments,
                replyTo: emailConfig_1.REPLY_TO,
            });
            if (error) {
                lastError = error;
                logger_1.default.warn(`Resend API attempt ${attempt} failed:`, {
                    errorType: error.name || "APIError",
                    from,
                    subject,
                });
                if (attempt < MAX_RETRIES) {
                    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
                    continue;
                }
                return { success: false, error };
            }
            logger_1.default.info("Email sent successfully via Resend", {
                messageId: data?.id,
                from,
                subject,
            });
            return { success: true, data };
        }
        catch (error) {
            lastError = error;
            logger_1.default.error(`Unexpected error in sendEmail (attempt ${attempt}):`, {
                error: error instanceof Error ? error.message : "Unknown error",
                from,
                subject,
            });
            if (attempt < MAX_RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
                continue;
            }
        }
    }
    return { success: false, error: lastError };
}
