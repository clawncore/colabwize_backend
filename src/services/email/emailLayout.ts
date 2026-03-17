export interface EmailLayoutOptions {
  title: string;
  content: string;
  ctaUrl?: string;
  ctaText?: string;
  footerText?: string;
  titleColor?: string;
}

/**
 * Centralized layout scaffold for all ColabWize emails.
 * Ensures strict brand consistency and scalable structural updates.
 */
export function buildEmailHtml({
  title,
  content,
  ctaUrl,
  ctaText,
  footerText = "ColabWize Team - Your Academic Integrity Partner",
  titleColor = "#1e40af", // Default to brand blue
}: EmailLayoutOptions): string {
  const currentYear = new Date().getFullYear();
  
  const ctaSection = ctaUrl && ctaText ? `
    <div style="margin: 35px 0; text-align: center;">
      <a href="${ctaUrl}" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(30, 64, 175, 0.2);">
        ${ctaText}
      </a>
    </div>
  ` : '';

  return `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
        
        <!-- Header -->
        <div style="margin-bottom: 30px; text-align: center;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo" style="width: 180px; height: auto; margin-bottom: 15px;">
          <h1 style="color: ${titleColor}; font-size: 24px; margin: 10px 0;">${title}</h1>
        </div>
        
        <!-- Main Content (Injected by templates) -->
        <div style="color: #475569; font-size: 16px; line-height: 1.6;">
          ${content}
        </div>
        
        <!-- Call to Action -->
        ${ctaSection}
        
        <!-- Footer -->
        <div style="border-top: 1px solid #e2e8f0; margin-top: 30px; padding-top: 20px;">
          <p style="color: #64748b; font-size: 13px; margin: 0; line-height: 1.6;">
            ${footerText}
          </p>
          <p style="color: #94a3b8; font-size: 13px; margin-top: 20px;">
            © ${currentYear} ColabWize. All rights reserved.
          </p>
        </div>
        
      </div>
    </div>
  `;
}
