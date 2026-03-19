import { EmailSender } from "./emailConfig";

interface SignatureProfile {
  name: string;
  title: string;
  email: string;
  department?: string;
}

/**
 * Per-alias signature profiles for the ColabWize admin email system.
 * Each alias gets its own professional signature injected at the bottom of manual emails.
 */
export const ALIAS_SIGNATURES: Record<EmailSender, SignatureProfile> = {
  SUPPORT: {
    name: "ColabWize Support Team",
    title: "Customer Support",
    email: "support@colabwize.com",
    department: "Support & Customer Experience"
  },
  HELP: {
    name: "ColabWize Help Desk",
    title: "Help & Assistance",
    email: "help@colabwize.com",
    department: "Help & Resources"
  },
  BILLING: {
    name: "ColabWize Billing Department",
    title: "Billing & Subscriptions",
    email: "billing@colabwize.com",
    department: "Finance & Billing"
  },
  TEAM: {
    name: "ColabWize Team",
    title: "Internal Communications",
    email: "team@colabwize.com",
    department: "Operations & Team"
  },
  INFO: {
    name: "ColabWize Information",
    title: "Platform Communications",
    email: "info@colabwize.com",
    department: "Communications"
  },
  MARKETING: {
    name: "ColabWize Marketing",
    title: "Marketing & Growth",
    email: "marketing@colabwize.com",
    department: "Marketing"
  },
  PRESS: {
    name: "ColabWize Press Office",
    title: "Media & Public Relations",
    email: "press@colabwize.com",
    department: "Press & Media"
  },
  LEGAL: {
    name: "ColabWize Legal Department",
    title: "Legal & Compliance",
    email: "legal@colabwize.com",
    department: "Legal & Compliance"
  },
  ENGINEERING: {
    name: "ColabWize Engineering",
    title: "Platform Engineering",
    email: "engineering@colabwize.com",
    department: "Engineering & Infrastructure"
  },
  WELCOME: {
    name: "ColabWize Team",
    title: "Onboarding & Welcome",
    email: "welcome@colabwize.com",
    department: "Onboarding"
  },
  VERIFY: {
    name: "ColabWize Security",
    title: "Account Verification",
    email: "verify@colabwize.com",
    department: "Identity & Security"
  },
  SECURITY: {
    name: "ColabWize Security Team",
    title: "Account Security",
    email: "security@colabwize.com",
    department: "Security"
  },
  NOTIFICATIONS: {
    name: "ColabWize Notifications",
    title: "Platform Notifications",
    email: "notifications@colabwize.com",
    department: "Platform"
  }
};

/**
 * Builds the wide, high-resolution branding banner for email headers.
 */
export function buildEmailHeader(): string {
  return `
    <div style="margin-bottom: 32px; text-align: center;">
      <img src="https://colabwize.com/email_logo.png" alt="ColabWize" style="width: 100%; max-width: 600px; height: auto; display: block; margin: 0 auto; border-radius: 8px;">
    </div>
  `;
}

/**
 * Builds the minimal "CW" logo block for footers.
 */
export function buildBrandedBlock(centered: boolean = false): string {
  const containerStyle = centered 
    ? "margin-bottom: 24px; text-align: center;" 
    : "margin-bottom: 24px; text-align: left;";
    
  return `
    <div style="${containerStyle}">
      <img src="https://colabwize.com/images/Colabwize-logo.png" alt="ColabWize" style="height: 48px; width: auto; display: inline-block;">
    </div>
  `;
}

/**
 * Builds the mandatory centered legal footer inspired by Product Hunt.
 * Appended to every manual and broadcast email.
 */
export function buildMandatoryFooter(recipientEmail?: string): string {
  const unsubscribeLink = recipientEmail 
    ? `https://colabwize.com/unsubscribe?email=${encodeURIComponent(recipientEmail)}`
    : `https://colabwize.com/unsubscribe`;

  return `
    <div style="margin-top: 48px; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #9ca3af; line-height: 1.6;">
      <!-- Footer Logo -->
      ${buildBrandedBlock(true)}

      <p style="font-size: 11px; margin: 0;">
        © ${new Date().getFullYear()} ColabWize. All rights reserved.
      </p>
      
      <p style="font-size: 11px; margin: 4px 0 0 0;">
        <a href="${unsubscribeLink}" style="color: #9ca3af; text-decoration: underline;">Unsubscribe</a> from these communications.
      </p>
    </div>
  `;
}

/**
 * Builds a clean, professional HTML signature block for the given alias.
 * Supports optional name and title overrides for a more personal touch.
 */
export function buildEmailSignature(
  alias: EmailSender, 
  overrideName?: string, 
  overrideTitle?: string
): string {
  const profile = { ...ALIAS_SIGNATURES[alias] };
  if (!profile && !overrideName) return "";

  if (overrideName) profile.name = overrideName;
  if (overrideTitle) profile.title = overrideTitle;

  return `
    <br>
    <div style="border-top: 2px solid #e5e7eb; margin-top: 32px; padding-top: 16px; font-family: Arial, sans-serif;">
      <table style="border-collapse: collapse;">
        <tr>
          <td style="padding-left: 16px; border-left: 3px solid #0ea5e9; vertical-align: top;">
            <p style="margin: 0 0 2px 0; font-size: 16px; font-weight: bold; color: #111827;">${profile.name}</p>
            <p style="margin: 0 0 2px 0; font-size: 13px; color: #6b7280;">${profile.title}${profile.department ? ` &bull; ${profile.department}` : ""}</p>
            <p style="margin: 6px 0 0 0; font-size: 13px;">
              <a href="mailto:${profile.email || ''}" style="color: #0ea5e9; text-decoration: none;">${profile.email || ''}</a>
              &nbsp;&bull;&nbsp;
              <a href="https://colabwize.com" style="color: #0ea5e9; text-decoration: none;">colabwize.com</a>
            </p>
          </td>
        </tr>
      </table>
      <p style="margin: 10px 0 0 0; font-size: 10px; color: #9ca3af;">
        This message was sent from the ColabWize secure administration platform. Please do not share its contents externally.
      </p>
    </div>
    ${buildMandatoryFooter()}
  `;
}
