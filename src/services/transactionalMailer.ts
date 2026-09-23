/**
 * Transactional Mailer — Provider Boundary Abstraction
 *
 * This module provides the explicit boundary between transactional
 * and marketing email systems:
 *
 * - `sendTransactionalEmail()` → Resend (auth, security, billing, notifications, OTP, etc.)
 * - `sendMarketingEmail()` → EmailOctopus (newsletters, campaigns, promotions)
 *
 * CRITICAL RULES:
 * - Authentication/security emails (OTP, password reset, 2FA, login alerts, etc.)
 *   MUST use sendTransactionalEmail() — NEVER sendMarketingEmail().
 * - Marketing emails MUST use sendMarketingEmail() — NEVER sendTransactionalEmail().
 * - The frontend NEVER selects the email provider; routing is controlled by the backend.
 * - If EmailOctopus is not configured, marketing sends fail gracefully with a clear error.
 */

import { sendEmail } from "./email/baseMailer";
import { EmailOptions, EmailSender } from "./email/emailConfig";
import { sendMarketingEmail as sendOctopusEmail } from "./marketing/marketingService";

/**
 * Sends a transactional email via Resend.
 *
 * For: auth flows, OTP, password reset, 2FA, security alerts,
 * billing receipts, transactional notifications, etc.
 *
 * @param options - Same EmailOptions shape as the existing sendEmail()
 * @returns { success, data?, error? }
 */
export async function sendTransactionalEmail(
  options: EmailOptions,
): Promise<{ success: boolean; data?: any; error?: Error }> {
  // Delegate to the existing Resend-based sendEmail which already
  // implements retry logic, logging, and masking.
  return sendEmail(options);
}

/**
 * Sends a marketing email via EmailOctopus.
 *
 * For: newsletters, promotional campaigns, product announcements,
 * feature spotlights, marketing broadcasts, etc.
 *
 * The recipient must be a subscriber in the EmailOctopus list.
 * Unsubscribed users are silently skipped.
 *
 * @param to - Recipient email address
 * @param subject - Email subject line
 * @param html - HTML email body (EmailOctopus appends its own footer)
 * @param text - Optional plain-text fallback
 * @returns { success, messageId?, error? }
 */
export async function sendMarketingEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  return sendOctopusEmail(to, subject, html, text);
}

// Re-export sendEmail for backward compatibility with existing callers
export { sendEmail } from "./email/baseMailer";
