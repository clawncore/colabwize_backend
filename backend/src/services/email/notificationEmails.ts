import { sendEmail } from "./baseMailer";
import { SecretsService } from "../secrets-service";
import { buildEmailHtml } from "./emailLayout";

/**
 * Sends a generic notification email.
 */
export async function sendNotificationEmail(
  to: string,
  fullName: string,
  title: string,
  message: string,
  type: string,
): Promise<boolean> {
  const frontendUrl = await SecretsService.getFrontendUrl();
  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>${message}</p>
    <p style="font-size: 14px;">You're receiving this because of your notification settings.</p>
  `;

  const html = buildEmailHtml({
    title,
    content,
    ctaText: "View in Dashboard",
    ctaUrl: `${frontendUrl}/dashboard`,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: title,
    html,
    text: `Hello ${fullName || "there"},\n\n${message}\n\nView details: ${frontendUrl}/dashboard\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends a workspace invitation email.
 */
export async function sendWorkspaceInvitation({
  to,
  workspaceName,
  inviterName,
  role,
  acceptUrl,
  expiresAt,
}: {
  to: string;
  workspaceName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  expiresAt: Date;
}): Promise<boolean> {
  const roleLabels = {
    admin: "Administrator",
    editor: "Editor",
    viewer: "Viewer",
  };

  const roleLabel = roleLabels[role as keyof typeof roleLabels] || role;

  const content = `
    <p>Hello,</p>
    <p><strong>${inviterName}</strong> has invited you to join the <strong>${workspaceName}</strong> workspace on ColabWize as a <strong>${roleLabel}</strong>.</p>
    
    <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 25px 0; border: 1px solid #e2e8f0;">
      <p style="margin: 0; font-size: 14px; color: #64748b;">
        ColabWize is the leading platform for academic integrity and defensible writing. Join your team to collaborate on projects and protect your work.
      </p>
    </div>
    
    <p style="font-size: 14px;">This invitation will expire on <strong>${expiresAt.toLocaleDateString()} at ${expiresAt.toLocaleTimeString()}</strong>.</p>
  `;

  const html = buildEmailHtml({
    title: "You've Been Invited!",
    content,
    ctaText: "Accept Invitation",
    ctaUrl: acceptUrl,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `Workspace Invitation: Join ${workspaceName} on ColabWize`,
    html,
    text: `Hello,\n\n${inviterName} has invited you to join the ${workspaceName} workspace as a ${roleLabel}.\n\nAccept Invitation: ${acceptUrl}\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends a workspace removal notification.
 */
export async function sendWorkspaceRemovalEmail({
  to,
  fullName,
  workspaceName,
  removerName,
}: {
  to: string;
  fullName: string;
  workspaceName: string;
  removerName: string;
}): Promise<boolean> {
  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>You have been removed from the <strong>${workspaceName}</strong> workspace by <strong>${removerName}</strong>.</p>

    <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 25px 0; border: 1px solid #e2e8f0;">
      <p style="margin: 0; font-size: 14px; color: #64748b;">
        If you believe this was a mistake, please reach out to the workspace administrator. You will no longer have access to projects and tasks within this workspace.
      </p>
    </div>
  `;

  const html = buildEmailHtml({
    title: "Workspace Access Updated",
    content,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `Workspace Update: Removed from ${workspaceName}`,
    html,
    text: `Hello ${fullName || "there"},\n\nYou have been removed from the ${workspaceName} workspace by ${removerName}.\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends a scan completion notification.
 */
export async function sendScanCompletionEmail(
  to: string,
  fullName: string,
  scanType: "originality" | "ai-detection" | "citations",
  projectName: string,
  resultSummary: string,
  dashboardUrl: string,
): Promise<boolean> {
  const scanTypeLabels = {
    originality: "Originality Check",
    "ai-detection": "AI Detection Scan",
    citations: "Citation Confidence Audit",
  };

  const subject = `Scan complete: ${projectName}`;

  const title = `${scanTypeLabels[scanType]} Complete!`;

  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>Your ${scanTypeLabels[scanType]} for <strong>"${projectName}"</strong> has been completed successfully.</p>
    
    <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
      <h2 style="color: #1e40af; margin-top: 0; font-size: 18px;">Results Summary</h2>
      <p style="margin: 5px 0; font-size: 16px; color: #333;">${resultSummary}</p>
    </div>
    
    <p style="font-size: 14px;">Your academic integrity is our priority. All scan results are private and securely stored.</p>
  `;

  const html = buildEmailHtml({
    title,
    content,
    ctaText: "View Full Results",
    ctaUrl: dashboardUrl,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject,
    html,
    text: `Hello ${fullName || "there"},\n\nYour ${scanTypeLabels[scanType]} for "${projectName}" has been completed.\n\nSummary: ${resultSummary}\n\nView Results: ${dashboardUrl}\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends a certificate ready notification.
 */
export async function sendCertificateReadyEmail(
  to: string,
  fullName: string,
  projectName: string,
  certificateUrl: string,
  retentionDays: number,
): Promise<boolean> {
  const retentionMessage =
    retentionDays === -1
      ? "Your certificate will be stored permanently."
      : retentionDays === 0
        ? "Download your certificate now - it will be deleted after download for security."
        : `Your certificate will be available for ${retentionDays} days before automatic deletion.`;

  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>Your Authorship Certificate for <strong>"${projectName}"</strong> has been generated and is ready for download.</p>
    
    <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
      <h2 style="color: #1e40af; margin-top: 0; font-size: 18px;">Certificate Details</h2>
      <p style="margin: 5px 0;"><strong>Project:</strong> ${projectName}</p>
      <p style="margin: 5px 0;"><strong>Generated:</strong> ${new Date().toLocaleDateString()}</p>
      <p style="margin: 5px 0; color: #dc2626;"><strong>Storage:</strong> ${retentionMessage}</p>
    </div>
    
    <p style="font-size: 14px;">This certificate serves as proof of authorship with timestamped activity tracking. Store it safely for your records.</p>
  `;

  const html = buildEmailHtml({
    title: "Your Authorship Certificate is Ready!",
    content,
    ctaText: "Download Certificate",
    ctaUrl: certificateUrl,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `Your Authorship Certificate is Ready - ${projectName}`,
    html,
    text: `Hello ${fullName || "there"},\n\nYour Authorship Certificate for "${projectName}" is ready.\n\nDownload: ${certificateUrl}\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends a collaboration notification.
 */
export async function sendCollaborationNotificationEmail(
  to: string,
  fullName: string,
  title: string,
  message: string,
  projectId: string,
  projectName: string,
): Promise<boolean> {
  const content = `
    <p>Hello ${fullName},</p>
    <p>${message}</p>
    
    <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
      <h2 style="color: #1e40af; margin-top: 0;">Project Details</h2>
      <p style="margin: 5px 0;"><strong>Project:</strong> ${projectName}</p>
      <p style="margin: 5px 0;"><strong>Project ID:</strong> ${projectId}</p>
    </div>
    
    <p style="font-size: 14px;">You're receiving this email because you are collaborating on this project.</p>
  `;

  const html = buildEmailHtml({
    title,
    content,
    ctaText: "View Project",
    ctaUrl: `http://app.colabwize.com/dashboard/projects/${projectId}`,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: title,
    html,
    text: `Hello ${fullName},\n\n${message}\n\nProject: ${projectName}\nView Project: http://app.colabwize.com/dashboard/projects/${projectId}\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends a usage limit warning notification.
 */
export async function sendUsageLimitWarningEmail(
  to: string,
  fullName: string,
  plan: string,
  scansUsed: number,
  scansLimit: number,
  upgradeUrl: string,
): Promise<boolean> {
  const percentage = Math.round((scansUsed / scansLimit) * 100);
  const remaining = scansLimit - scansUsed;

  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>You've used <strong>${scansUsed} out of ${scansLimit}</strong> scans on your <strong>${plan}</strong> plan this month. Only <strong>${remaining} scans</strong> remaining!</p>
    
    <div style="background-color: #fef3c7; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #f59e0b;">
      <h2 style="color: #92400e; margin-top: 0; font-size: 18px;">Usage Status</h2>
      <div style="background-color: #e5e7eb; height: 20px; border-radius: 10px; overflow: hidden; margin: 15px 0;">
        <div style="background-color: ${percentage >= 90 ? "#ef4444" : "#f59e0b"}; height: 100%; width: ${percentage}%; transition: width 0.3s;"></div>
      </div>
      <p style="margin: 5px 0; color: #78350f;"><strong>${percentage}% used</strong> - ${remaining} scans left</p>
    </div>
    
    <p>${percentage >= 90 ? "Consider upgrading your plan to avoid interruptions to your academic work!" : "Upgrade now to get more scans and unlock premium features!"}</p>
    <p style="font-size: 14px;">Your usage will reset on the 1st of next month.</p>
  `;

  const html = buildEmailHtml({
    title: "Approaching Your Scan Limit",
    titleColor: "#ea580c",
    content,
    ctaText: "Upgrade Your Plan",
    ctaUrl: upgradeUrl,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `You've used ${percentage}% of your monthly scans`,
    html,
    text: `Hello ${fullName || "there"},\n\nYou've used ${percentage}% of your monthly scans. Only ${remaining} remaining.\n\nUpgrade Plan: ${upgradeUrl}\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends a usage limit reached notification.
 */
export async function sendUsageLimitReachedEmail(
  to: string,
  fullName: string,
  plan: string,
  resetDate: string,
  upgradeUrl: string,
): Promise<boolean> {
  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>You've reached your monthly scan limit on the <strong>${plan}</strong> plan.</p>
    
    <div style="background-color: #fee2e2; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #dc2626;">
      <h2 style="color: #991b1b; margin-top: 0; font-size: 18px;">What This Means</h2>
      <ul style="margin: 10px 0; padding-left: 20px; color: #7f1d1d;">
        <li>You cannot run new scans until you upgrade or your limit resets</li>
        <li>Your usage will reset on <strong>${resetDate}</strong></li>
        <li>Upgrade now to continue scanning immediately</li>
      </ul>
    </div>
    
    <p style="font-size: 14px;">All your existing results remain available. Upgrade to continue protecting your work.</p>
  `;

  const html = buildEmailHtml({
    title: "Monthly Limit Reached",
    titleColor: "#dc2626",
    content,
    ctaText: "Upgrade Now",
    ctaUrl: upgradeUrl,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `Monthly Scan Limit Reached - ${plan} Plan`,
    html,
    text: `Hello ${fullName || "there"},\n\nYou've reached your monthly scan limit. Upgrade now to continue scanning.\n\nUpgrade: ${upgradeUrl}\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends a search alert notification.
 */
export async function sendSearchAlertEmail(
  to: string,
  fullName: string,
  query: string,
  matchCount: number,
  results: any[],
): Promise<boolean> {
  const frontendUrl = await SecretsService.getFrontendUrl();
  const resultsHtml = results
    .slice(0, 5)
    .map(
      (paper) => `
    <div style="margin-bottom: 20px; padding: 15px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h3 style="margin: 0 0 5px 0; font-size: 16px; color: #1e40af;">${paper.title}</h3>
      <p style="margin: 0 0 5px 0; font-size: 14px; color: #475569;">${paper.authors ? paper.authors.join(", ") : "Unknown Authors"}${paper.year ? ` • ${paper.year}` : ""}</p>
      ${paper.url ? `<a href="${paper.url}" style="font-size: 13px; color: #4f46e5; text-decoration: none;">View Paper →</a>` : ""}
    </div>
  `,
    )
    .join("");

  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>We found <strong>${matchCount}</strong> new research papers matching your alert for: <span style="color: #1e40af; font-weight: bold;">"${query}"</span>.</p>

    <div style="margin: 30px 0;">
      ${resultsHtml}
    </div>
    
    <p style="font-size: 14px;">You requested ${query} alerts. You can manage them in your dashboard.</p>
  `;

  const html = buildEmailHtml({
    title: "New Research Matches",
    content,
    ctaText: "View All Matches",
    ctaUrl: `${frontendUrl}/dashboard`,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `New Research Found: ${query}`,
    html,
    text: `Hello ${fullName || "there"},\n\nWe found ${matchCount} new research papers matching ${query}.\n\nView them in your dashboard: ${frontendUrl}/dashboard\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends a project share email with an attachment.
 */
export async function sendProjectShareEmail(
  to: string,
  subject: string,
  htmlContent: string,
  attachmentBuffer: Buffer,
  attachmentFilename: string,
): Promise<boolean> {
  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject,
    html: htmlContent,
    text: htmlContent.replace(/<[^>]+>/g, ''), // Strip html for text
    attachments: [
      {
        filename: attachmentFilename,
        content: attachmentBuffer,
      },
    ],
  });

  return success;
}

/**
 * Sends an analytics notification email.
 */
export async function sendAnalyticsNotificationEmail(
  to: string,
  fullName: string,
  title: string,
  message: string,
  data?: any,
): Promise<boolean> {
  const content = `
    <p>Hello ${fullName},</p>
    <p>${message}</p>
    
    ${
      data
        ? `<div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
        <h2 style="color: #1e40af; margin-top: 0;">Analytics Data</h2>
        <pre style="white-space: pre-wrap; word-wrap: break-word; background-color: #fff; padding: 10px; border-radius: 4px; font-size: 14px;">${JSON.stringify(data, null, 2)}</pre>
      </div>`
        : ""
    }
    
    <p style="font-size: 14px;">You're receiving this email because you have analytics notifications enabled.</p>
  `;

  const html = buildEmailHtml({
    title,
    content,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: title,
    html,
    text: `Hello ${fullName},\n\n${message}\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends an analytics report email with attachment.
 */
export async function sendAnalyticsReportEmail(
  to: string,
  fullName: string,
  period: "week" | "month" | "year",
  reportPath: string,
  reportFileName: string,
  summaryData?: { totalScans: number; avgOriginality: number; topProject: string },
): Promise<boolean> {
  const fs = require("fs");
  const reportBuffer = fs.readFileSync(reportPath);
  const frontendUrl = await SecretsService.getFrontendUrl();

  const periodLabels = {
    week: "Weekly",
    month: "Monthly",
    year: "Yearly",
  };

  const subject = `ColabWize ${periodLabels[period]} Analytics Report`;

  const summaryHtml = summaryData ? `
    <div style="background-color: #f8fafc; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #1e40af;">
      <h3 style="margin-top: 0; font-size: 16px;">Key Metrics Summary</h3>
      <ul style="padding-left: 20px;">
        <li><strong>Total Scans:</strong> ${summaryData.totalScans}</li>
        <li><strong>Avg. Originality:</strong> ${summaryData.avgOriginality}%</li>
        <li><strong>Top Project:</strong> ${summaryData.topProject}</li>
      </ul>
    </div>
  ` : '';

  const content = `
    <p>Hello ${fullName},</p>
    <p>Your ${periodLabels[period].toLowerCase()} analytics report is now available. Please find the attached PDF document for full details.</p>
    
    ${summaryHtml}
    
    <p style="font-size: 14px;">You're receiving this email because you have automated analytics reports enabled.</p>
  `;

  const html = buildEmailHtml({
    title: `${periodLabels[period]} Analytics Report`,
    content,
    ctaText: "View Full Analytics Dashboard",
    ctaUrl: `${frontendUrl}/dashboard/analytics`,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject,
    html,
    text: `Hello ${fullName},\n\nYour ${periodLabels[period].toLowerCase()} analytics report is attached.\n\nView your dashboard: ${frontendUrl}/dashboard/analytics\n\nColabWize Team`,
    attachments: [
      {
        filename: reportFileName,
        content: reportBuffer,
      },
    ],
  });

  return success;
}

/**
 * Sends institutional plan request emails.
 */
export async function sendInstitutionalPlanRequestEmail({
  institutionName,
  contactName,
  contactEmail,
  contactPhone,
  institutionType,
  estimatedUsers,
  department,
  message,
}: {
  institutionName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  institutionType: string;
  estimatedUsers: number;
  department?: string;
  message?: string;
}): Promise<boolean> {
  // 1. Send notification to sales team
  const salesContent = `
    <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
      <p><strong>Institution:</strong> ${institutionName}</p>
      <p><strong>Contact Person:</strong> ${contactName}</p>
      <p><strong>Contact Email:</strong> ${contactEmail}</p>
      <p><strong>Contact Phone:</strong> ${contactPhone}</p>
      <p><strong>Institution Type:</strong> ${institutionType}</p>
      <p><strong>Estimated Users:</strong> ${estimatedUsers}</p>
      ${department ? `<p><strong>Department:</strong> ${department}</p>` : ""}
      ${message ? `<p><strong>Message:</strong> ${message}</p>` : ""}
    </div>
  `;

  const salesHtml = buildEmailHtml({
    title: "New Institutional Plan Request",
    content: salesContent,
  });

  await sendEmail({
    from: "NOTIFICATIONS",
    to: "sales@colabwize.com",
    subject: `New Institutional Plan Request - ${institutionName}`,
    html: salesHtml,
    text: `New Institutional Plan Request from ${institutionName}.\nContact: ${contactName} (${contactEmail})`,
  });

  // 2. Send confirmation to requester
  const confirmationContent = `
    <p>Hello ${contactName},</p>
    <p>Thank you for your interest in ColabWize's institutional plan. We have received your request and our team will contact you within 1 business day to discuss your specific needs.</p>
  `;

  const confirmationHtml = buildEmailHtml({
    title: "Request Received",
    content: confirmationContent,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to: contactEmail,
    subject: "ColabWize Institutional Plan Request Received",
    html: confirmationHtml,
    text: `Hello ${contactName},\n\nThank you for your interest. We will contact you within 1 business day.\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends a certificate expiration warning.
 */
export async function sendCertificateExpirationWarningEmail(
  to: string,
  fullName: string,
  certificateCount: number,
  expirationDate: string,
  downloadUrl: string,
): Promise<boolean> {
  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>You have <strong>${certificateCount} authorship certificate${certificateCount > 1 ? "s" : ""}</strong> that will be automatically deleted on <strong>${expirationDate}</strong>.</p>
    
    <p style="font-size: 14px;">Storage limits based on plan:<br/>Free: 7 days | Student: 30 days | Researcher: Unlimited</p>
  `;

  const html = buildEmailHtml({
    title: "Certificates Expiring Soon",
    titleColor: "#ea580c",
    content,
    ctaText: "Download Certificates",
    ctaUrl: downloadUrl,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `${certificateCount} Certificate${certificateCount > 1 ? "s" : ""} Expiring Soon`,
    html,
    text: `Hello ${fullName || "there"},\n\nYou have ${certificateCount} certificates expiring on ${expirationDate}.\n\nDownload them here: ${downloadUrl}\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends a referral reward notification email.
 */
export async function sendReferralRewardEmail(
  to: string,
  fullName: string,
  days: number,
): Promise<boolean> {
  const frontendUrl = await SecretsService.getFrontendUrl();
  
  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>Great news! Someone just signed up using your referral code. As a thank you, you've been upgraded to <strong>Plus plan</strong> for <strong>${days} days</strong> - absolutely free!</p>
    
    <div style="background-color: #d1fae5; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #10b981;">
      <h2 style="color: #065f46; margin-top: 0; font-size: 18px;">Your Plus Plan Benefits</h2>
      <ul style="margin: 10px 0; padding-left: 20px; color: #047857;">
        <li><strong>25 document scans</strong> per month</li>
        <li><strong>10 Originality Scans</strong> included</li>
        <li><strong>50 AI Chat</strong> messages</li>
        <li><strong>Professional certificates</strong> without watermarks</li>
        <li><strong>Priority email support</strong></li>
      </ul>
      <p style="margin: 15px 0 0 0; font-size: 14px; color: #065f46;">
        <strong>Valid until:</strong> ${new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleDateString()}
      </p>
    </div>
    
    <p style="font-size: 14px;">Keep sharing your referral code to earn more free days! Each successful referral gives you another ${days} days of Plus.</p>
    <p style="font-size: 14px; color: #6b7280;">Your referral code: <strong style="color: #1e40af; font-size: 16px;">View in your dashboard</strong></p>
  `;

  const html = buildEmailHtml({
    title: "You Earned Free Plus Plan!",
    titleColor: "#059669",
    content,
    ctaText: "Go to Dashboard",
    ctaUrl: `${frontendUrl}/dashboard`,
  });

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `You got ${days} days of Plus plan free!`,
    html,
    text: `Hello ${fullName || "there"},\n\nSomeone signed up using your referral code! You now have ${days} days of Plus plan free.\n\nView your dashboard: ${frontendUrl}/dashboard\n\nColabWize Team`,
  });

  return success;
}
