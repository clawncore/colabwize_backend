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
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
      <tr>
        <td align="center" style="padding: 0;">
          <img src="https://colabwize.com/email_logo.png" alt="ColabWize" style="width: 100%; max-width: 600px; height: auto; display: block; margin: 0 auto;">
        </td>
      </tr>
    </table>
  `;
}

/**
 * Builds the minimal "CW" logo block for footers.
 */
export function buildBrandedBlock(centered: boolean = false): string {
  const tableMargin = centered ? 'margin: 0 auto 24px auto;' : 'margin: 0 0 24px 0;';

  return `
    <table border="0" cellpadding="0" cellspacing="0" style="${tableMargin} border-collapse: collapse; text-align: left;">
      <tr>
        <td style="vertical-align: middle; padding-right: 20px;">
          <img src="https://colabwize.com/images/Colabwize-logo.png" alt="ColabWize" style="height: 52px; width: auto; display: block;">
        </td>
        <td style="vertical-align: middle; border-left: 1px solid #e5e7eb; padding-left: 20px;">
          <h1 style="margin: 0; font-size: 22px; font-weight: 800; color: #111827; letter-spacing: -0.5px; font-family: sans-serif;">ColabWize</h1>
          <p style="margin: 2px 0 0 0; font-size: 13px; color: #64748b; font-weight: 500; font-family: sans-serif;">A Platform for Original, Credible, and Human Work.</p>
        </td>
      </tr>
    </table>
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
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-top: 64px; text-align: center; border-top: 1px solid #f1f5f9; font-family: sans-serif;">
      <tr>
        <td style="padding: 40px 20px;">
          <!-- Footer Branding -->
          ${buildBrandedBlock(true)}

          <div style="margin-bottom: 32px; font-size: 14px; color: #64748b; line-height: 1.6; max-width: 500px; margin-left: auto; margin-right: auto;">
            <p style="margin: 0 0 12px 0;">If you have any questions, feedback, ideas or problems don't hesitate to <a href="https://colabwize.com/contact" style="color: #0ea5e9; text-decoration: underline;">contact us!</a></p>
            <p style="margin: 0;">You can <a href="https://colabwize.com/dashboard/settings" style="color: #0ea5e9; text-decoration: underline;">manage</a> which email notifications you receive or <a href="${unsubscribeLink}" style="color: #0ea5e9; text-decoration: underline;">unsubscribe</a> from our communications.</p>
          </div>

          <div style="margin-bottom: 24px; font-size: 13px; font-weight: 500; color: #64748b;">
            Checkout: <a href="https://colabwize.com/resources/updates" style="color: #0ea5e9; text-decoration: none;">Updates</a>, 
            <a href="https://colabwize.com/resources/newsletter" style="color: #0ea5e9; text-decoration: none;">Newsletter</a> or 
            <a href="https://colabwize.com/contact" style="color: #0ea5e9; text-decoration: none;">Support</a>
          </div>

          <div style="margin-bottom: 32px;">
            <a href="https://x.com/colabwize" style="color: #111827; text-decoration: none; font-weight: bold; font-size: 14px;">Follow us on X</a>
          </div>

          <p style="font-size: 11px; color: #9ca3af; margin: 0;">
            © ${new Date().getFullYear()} ColabWize. All rights reserved.
          </p>
        </td>
      </tr>
    </table>
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
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top: 2px solid #e5e7eb; margin-top: 32px; font-family: sans-serif;">
      <tr>
        <td style="padding-top: 16px; padding-left: 16px; border-left: 3px solid #0ea5e9; vertical-align: top;">
          <p style="margin: 0 0 2px 0; font-size: 16px; font-weight: bold; color: #111827;">${profile.name}</p>
          <p style="margin: 0 0 2px 0; font-size: 13px; color: #6b7280;">${profile.title}${profile.department ? ` &bull; ${profile.department}` : ""}</p>
          <p style="margin: 6px 0 0 0; font-size: 13px;">
            <a href="mailto:${profile.email || ''}" style="color: #0ea5e9; text-decoration: none;">${profile.email || ''}</a>
            &nbsp;&bull;&nbsp;
            <a href="https://colabwize.com" style="color: #0ea5e9; text-decoration: none;">colabwize.com</a>
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding-top: 10px;">
          <p style="margin: 0; font-size: 10px; color: #9ca3af;">
            This message was sent from the ColabWize secure administration platform. Please do not share its contents externally.
          </p>
        </td>
      </tr>
    </table>
    ${buildMandatoryFooter()}
  `;
}
