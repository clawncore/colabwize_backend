import { buildMandatoryFooter, buildBrandedBlock } from "./emailSignatures";

export interface EmailLayoutOptions {
  title: string;
  content: string;
  ctaUrl?: string;
  ctaText?: string;
  footerText?: string;
  titleColor?: string;
  recipientEmail?: string;
}

/**
 * Centralized layout scaffold for all ColabWize automated system emails
 * (welcome, verify, notifications). Contains the full corporate footer
 * with social links and unsubscribe.
 */
export function buildEmailHtml({
  title,
  content,
  ctaUrl,
  ctaText,
  titleColor = "#111827",
  recipientEmail,
}: EmailLayoutOptions): string {
  const currentYear = new Date().getFullYear();

  const ctaSection = ctaUrl && ctaText ? `
    <div style="margin: 35px 0; text-align: center;">
      <a href="${ctaUrl}" style="background-color: #111827; color: white; padding: 14px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        ${ctaText}
      </a>
    </div>
  ` : '';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f4f5; padding: 40px 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 40px; border-radius: 20px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);">

        <!-- Header Branding -->
        ${buildBrandedBlock(true)}

        <!-- Main Title -->
        <h1 style="color: ${titleColor}; font-size: 24px; font-weight: 800; margin: 30px 0 20px 0; text-align: center;">${title}</h1>

        <!-- Main Content -->
        <div style="color: #475569; font-size: 16px; line-height: 1.6;">
          ${content}
        </div>

        <!-- Call to Action -->
        ${ctaSection}

      </div>

      <!-- Automated System Footer -->
      <div style="max-width: 600px; margin: 0 auto;">
        ${buildMandatoryFooter(recipientEmail)}
      </div>
    </div>
  `;
}
