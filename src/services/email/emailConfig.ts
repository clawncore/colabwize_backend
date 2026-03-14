/**
 * Centralized email configuration for ColabWize.
 */

export const SENDER_IDENTITIES = {
  VERIFY: "ColabWize Verify <verify@colabwize.com>",
  SECURITY: "ColabWize Security <security@colabwize.com>",
  NOTIFICATIONS: "ColabWize Notifications <notifications@colabwize.com>",
  BILLING: "ColabWize Billing <billing@colabwize.com>",
} as const;

export type EmailSender = keyof typeof SENDER_IDENTITIES;

export const REPLY_TO = "support@colabwize.com";

export interface EmailOptions {
  from: EmailSender;
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
  }>;
}
