/**
 * Centralized email configuration for ColabWize.
 */

export const SENDER_IDENTITIES = {
  WELCOME: "ColabWize Team <welcome@colabwize.com>",
  VERIFY: "ColabWize Verify <verify@colabwize.com>",
  SECURITY: "ColabWize Security <security@colabwize.com>",
  NOTIFICATIONS: "ColabWize Notifications <notifications@colabwize.com>",
  BILLING: "ColabWize Billing <billing@colabwize.com>",
  HELP: "ColabWize Help <help@colabwize.com>",
  SUPPORT: "ColabWize Support <support@colabwize.com>",
  TEAM: "ColabWize Team <team@colabwize.com>",
  MARKETING: "ColabWize Marketing <marketing@colabwize.com>",
  INFO: "ColabWize Info <info@colabwize.com>",
  PRESS: "ColabWize Press <press@colabwize.com>",
  LEGAL: "ColabWize Legal <legal@colabwize.com>",
  ENGINEERING: "ColabWize Engineering <engineering@colabwize.com>",
} as const;

export type EmailSender = keyof typeof SENDER_IDENTITIES;

export const REPLY_TO = "support@colabwize.com";

export interface EmailOptions {
  from: EmailSender;
  to: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
  }>;
}
