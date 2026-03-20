import { buildMandatoryFooter, buildBrandedBlock, buildEmailHeader, buildEmailSignature } from "./emailSignatures";
import { EmailSender } from "./emailConfig";

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
  const ctaSection = ctaUrl && ctaText ? `
    <div style="margin: 35px 0; text-align: center;">
      <a href="${ctaUrl}" style="background-color: #111827; color: white; padding: 14px 28px; text-decoration: none; border-radius: 12px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        ${ctaText}
      </a>
    </div>
  ` : '';

  return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f8fafc">
    <tr>
      <td align="center" style="padding: 40px 15px;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 24px; border: 1px solid #e2e8f0; box-shadow: 0 4px 25px rgba(0, 0, 0, 0.04); overflow: hidden;">
          <tr>
            <td style="padding: 40px;">
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
            </td>
          </tr>
        </table>
        
        <!-- Automated System Footer -->
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; margin-top: 20px;">
          <tr>
            <td align="center">
              ${buildMandatoryFooter(recipientEmail)}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

/**
 * Wraps manual/admin email content in a premium, card-based layout.
 * Best for newsletters, direct support, and marketing announcements.
 */
export function wrapInPremiumLayout(
  content: string,
  senderAlias: EmailSender,
  senderName?: string,
  senderTitle?: string,
  recipientEmail?: string
): string {
  const signature = buildEmailSignature(senderAlias, senderName, senderTitle);
  const header = buildEmailHeader();

  return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <style type="text/css">
    .content-area img { max-width: 100% !important; height: auto !important; border-radius: 12px; margin: 20px 0; }
    .content-area a { color: #0ea5e9; text-decoration: underline; }
    .content-area p { margin-bottom: 20px; line-height: 1.7; }
    .content-area ul, .content-area ol { padding-left: 20px; margin-bottom: 20px; }
    .content-area li { margin-bottom: 8px; }
    .content-area h1, .content-area h2, .content-area h3 { color: #111827; margin: 30px 0 15px 0; letter-spacing: -0.02em; }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  <table border="0" cellpadding="0" cellspacing="0" width="100%" bgcolor="#f1f5f9">
    <tr>
      <td align="center" style="padding: 40px 10px;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; box-shadow: 0 4px 30px rgba(0, 0, 0, 0.05); overflow: hidden;">
          <!-- Banner Header -->
          <tr>
            <td style="padding: 0; text-align: center;">
              ${header}
            </td>
          </tr>

          <!-- Main Body Content -->
          <tr>
            <td class="content-area" style="padding: 40px 40px 10px 40px; color: #334155; font-size: 16px;">
              ${content}
            </td>
          </tr>

          <!-- Signature area (inside card) -->
          <tr>
            <td style="padding: 0 40px 40px 40px;">
              ${signature}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}
