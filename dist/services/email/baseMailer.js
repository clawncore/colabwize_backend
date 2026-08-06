"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
const logger_1 = __importDefault(require("../../monitoring/logger"));
const resendClient_1 = require("./resendClient");
const emailConfig_1 = require("./emailConfig");
const prisma_1 = require("../../lib/prisma");
/**
 * Mask sensitive content in email bodies before storing.
 * Hides OTP codes, tokens, passwords, and API keys.
 */
function maskSensitiveContent(html) {
    return html
        // OTP / verification codes (4-8 digit numbers in context)
        .replace(/(code|otp|verification|verify|pin)[:\s]*(\d{4,8})/gi, (_, label, code) => `${label}: ${"*".repeat(code.length)}`)
        // Bare 6-digit codes in prominent positions (likely OTPs)
        .replace(/(?:^|\n|\s)(\d{6})(?:\s|\n|$)/gm, " **** ")
        // Passwords / tokens
        .replace(/(password|token|secret|api.?key|authorization)[:\s]*["']?([^"'\s<]{8,})["']?/gi, (_, label) => `${label}: [REDACTED]`)
        // JWT tokens
        .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, "[JWT_TOKEN]")
        // Supabase / reset links — keep domain, mask token portion
        .replace(/(https?:\/\/[^/]+\/auth\/[^?]*\?)(token=[^&]+)/gi, (_, prefix) => `${prefix}token=[REDACTED]`)
        // Email addresses in body (keep first 2 chars + domain)
        .replace(/([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, (_, first, domain) => `${first}***@${domain}`);
}
/**
 * Base function to send an email using Resend with retry logic.
 * Centralizes common parameters like reply_to and handles errors.
 * Automatically logs every email to EmailLog for admin audit.
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
                // Log failed email
                logEmailToDatabase(to, from, subject, html, "failed", error?.message || "Max retries exceeded");
                return { success: false, error };
            }
            logger_1.default.info("Email sent successfully via Resend", {
                messageId: data?.id,
                from,
                subject,
            });
            // Log successful email
            logEmailToDatabase(to, from, subject, html, "sent");
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
/**
 * Non-blocking email log writer. Catches errors internally so a
 * logging failure never blocks or fails the actual email send.
 */
function logEmailToDatabase(to, sender, subject, html, status, error) {
    const maskedBody = maskSensitiveContent(html || "");
    prisma_1.prisma.emailLog.create({
        data: {
            recipient: to,
            sender,
            subject,
            status,
            error: error || null,
            message_body: maskedBody,
        },
    }).catch((err) => {
        // Never let logging failures affect email delivery
        logger_1.default.warn("Failed to log email to database:", { error: err.message });
    });
}
