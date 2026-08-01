"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendNotificationEmail = sendNotificationEmail;
exports.sendWorkspaceInvitation = sendWorkspaceInvitation;
exports.sendWorkspaceRemovalEmail = sendWorkspaceRemovalEmail;
exports.sendScanCompletionEmail = sendScanCompletionEmail;
exports.sendCertificateReadyEmail = sendCertificateReadyEmail;
exports.sendCollaborationNotificationEmail = sendCollaborationNotificationEmail;
exports.sendUsageLimitWarningEmail = sendUsageLimitWarningEmail;
exports.sendUsageLimitReachedEmail = sendUsageLimitReachedEmail;
exports.sendSearchAlertEmail = sendSearchAlertEmail;
exports.sendProjectShareEmail = sendProjectShareEmail;
exports.sendAnalyticsNotificationEmail = sendAnalyticsNotificationEmail;
exports.sendAnalyticsReportEmail = sendAnalyticsReportEmail;
exports.sendInstitutionalPlanRequestEmail = sendInstitutionalPlanRequestEmail;
exports.sendCertificateExpirationWarningEmail = sendCertificateExpirationWarningEmail;
exports.sendReferralRewardEmail = sendReferralRewardEmail;
exports.sendUnusualLoginAlertEmail = sendUnusualLoginAlertEmail;
exports.sendNewDeviceLoginEmail = sendNewDeviceLoginEmail;
const baseMailer_1 = require("./baseMailer");
const secrets_service_1 = require("../secrets-service");
const emailLayout_1 = require("./emailLayout");
/**
 * Sends a generic notification email.
 */
async function sendNotificationEmail(to, fullName, title, message, type) {
    const frontendUrl = await secrets_service_1.SecretsService.getFrontendUrl();
    const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>${message}</p>
    <p style="font-size: 14px;">You're receiving this because of your notification settings.</p>
  `;
    const html = (0, emailLayout_1.buildEmailHtml)({
        title,
        content,
        ctaText: "View in Dashboard",
        ctaUrl: `${frontendUrl}/dashboard`,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendWorkspaceInvitation({ to, workspaceName, inviterName, role, acceptUrl, expiresAt, }) {
    const roleLabels = {
        admin: "Administrator",
        editor: "Editor",
        viewer: "Viewer",
    };
    const roleLabel = roleLabels[role] || role;
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
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: "You've Been Invited!",
        content,
        ctaText: "Accept Invitation",
        ctaUrl: acceptUrl,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendWorkspaceRemovalEmail({ to, fullName, workspaceName, removerName, }) {
    const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>You have been removed from the <strong>${workspaceName}</strong> workspace by <strong>${removerName}</strong>.</p>

    <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 25px 0; border: 1px solid #e2e8f0;">
      <p style="margin: 0; font-size: 14px; color: #64748b;">
        If you believe this was a mistake, please reach out to the workspace administrator. You will no longer have access to projects and tasks within this workspace.
      </p>
    </div>
  `;
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: "Workspace Access Updated",
        content,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendScanCompletionEmail(to, fullName, scanType, projectName, resultSummary, dashboardUrl) {
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
    const html = (0, emailLayout_1.buildEmailHtml)({
        title,
        content,
        ctaText: "View Full Results",
        ctaUrl: dashboardUrl,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendCertificateReadyEmail(to, fullName, projectName, certificateUrl, retentionDays) {
    const retentionMessage = retentionDays === -1
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
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: "Your Authorship Certificate is Ready!",
        content,
        ctaText: "Download Certificate",
        ctaUrl: certificateUrl,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendCollaborationNotificationEmail(to, fullName, title, message, projectId, projectName) {
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
    const html = (0, emailLayout_1.buildEmailHtml)({
        title,
        content,
        ctaText: "View Project",
        ctaUrl: `http://app.colabwize.com/dashboard/projects/${projectId}`,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendUsageLimitWarningEmail(to, fullName, plan, scansUsed, scansLimit, upgradeUrl) {
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
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: "Approaching Your Scan Limit",
        titleColor: "#ea580c",
        content,
        ctaText: "Upgrade Your Plan",
        ctaUrl: upgradeUrl,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendUsageLimitReachedEmail(to, fullName, plan, resetDate, upgradeUrl) {
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
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: "Monthly Limit Reached",
        titleColor: "#dc2626",
        content,
        ctaText: "Upgrade Now",
        ctaUrl: upgradeUrl,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendSearchAlertEmail(to, fullName, query, matchCount, results) {
    const frontendUrl = await secrets_service_1.SecretsService.getFrontendUrl();
    const resultsHtml = results
        .slice(0, 5)
        .map((paper) => `
    <div style="margin-bottom: 20px; padding: 15px; background: #fff; border: 1px solid #e2e8f0; border-radius: 8px;">
      <h3 style="margin: 0 0 5px 0; font-size: 16px; color: #1e40af;">${paper.title}</h3>
      <p style="margin: 0 0 5px 0; font-size: 14px; color: #475569;">${paper.authors ? paper.authors.join(", ") : "Unknown Authors"}${paper.year ? ` • ${paper.year}` : ""}</p>
      ${paper.url ? `<a href="${paper.url}" style="font-size: 13px; color: #4f46e5; text-decoration: none;">View Paper →</a>` : ""}
    </div>
  `)
        .join("");
    const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>We found <strong>${matchCount}</strong> new research papers matching your alert for: <span style="color: #1e40af; font-weight: bold;">"${query}"</span>.</p>

    <div style="margin: 30px 0;">
      ${resultsHtml}
    </div>
    
    <p style="font-size: 14px;">You requested ${query} alerts. You can manage them in your dashboard.</p>
  `;
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: "New Research Matches",
        content,
        ctaText: "View All Matches",
        ctaUrl: `${frontendUrl}/dashboard`,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendProjectShareEmail(to, subject, htmlContent, attachmentBuffer, attachmentFilename) {
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendAnalyticsNotificationEmail(to, fullName, title, message, data) {
    const content = `
    <p>Hello ${fullName},</p>
    <p>${message}</p>
    
    ${data
        ? `<div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
        <h2 style="color: #1e40af; margin-top: 0;">Analytics Data</h2>
        <pre style="white-space: pre-wrap; word-wrap: break-word; background-color: #fff; padding: 10px; border-radius: 4px; font-size: 14px;">${JSON.stringify(data, null, 2)}</pre>
      </div>`
        : ""}
    
    <p style="font-size: 14px;">You're receiving this email because you have analytics notifications enabled.</p>
  `;
    const html = (0, emailLayout_1.buildEmailHtml)({
        title,
        content,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendAnalyticsReportEmail(to, fullName, period, reportPath, reportFileName, summaryData) {
    const fs = require("fs");
    const reportBuffer = fs.readFileSync(reportPath);
    const frontendUrl = await secrets_service_1.SecretsService.getFrontendUrl();
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
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: `${periodLabels[period]} Analytics Report`,
        content,
        ctaText: "View Full Analytics Dashboard",
        ctaUrl: `${frontendUrl}/dashboard/analytics`,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendInstitutionalPlanRequestEmail({ institutionName, contactName, contactEmail, contactPhone, institutionType, estimatedUsers, department, message, }) {
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
    const salesHtml = (0, emailLayout_1.buildEmailHtml)({
        title: "New Institutional Plan Request",
        content: salesContent,
    });
    await (0, baseMailer_1.sendEmail)({
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
    const confirmationHtml = (0, emailLayout_1.buildEmailHtml)({
        title: "Request Received",
        content: confirmationContent,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendCertificateExpirationWarningEmail(to, fullName, certificateCount, expirationDate, downloadUrl) {
    const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>You have <strong>${certificateCount} authorship certificate${certificateCount > 1 ? "s" : ""}</strong> that will be automatically deleted on <strong>${expirationDate}</strong>.</p>
    
    <p style="font-size: 14px;">Storage limits based on plan:<br/>Free: 7 days | Student: 30 days | Researcher: Unlimited</p>
  `;
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: "Certificates Expiring Soon",
        titleColor: "#ea580c",
        content,
        ctaText: "Download Certificates",
        ctaUrl: downloadUrl,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
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
async function sendReferralRewardEmail(to, fullName, days) {
    const frontendUrl = await secrets_service_1.SecretsService.getFrontendUrl();
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
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: "You Earned Free Plus Plan!",
        titleColor: "#059669",
        content,
        ctaText: "Go to Dashboard",
        ctaUrl: `${frontendUrl}/dashboard`,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
        from: "NOTIFICATIONS",
        to,
        subject: `You got ${days} days of Plus plan free!`,
        html,
        text: `Hello ${fullName || "there"},\n\nSomeone signed up using your referral code! You now have ${days} days of Plus plan free.\n\nView your dashboard: ${frontendUrl}/dashboard\n\nColabWize Team`,
    });
    return success;
}
/**
 * Sends a security alert email for unusual login attempts.
 */
async function sendUnusualLoginAlertEmail(to, fullName, ipAddress, location, device, browser) {
    const frontendUrl = await secrets_service_1.SecretsService.getFrontendUrl();
    const timestamp = new Date().toLocaleString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
    });
    const locationCard = generateLocationCardHtml(location, ipAddress);
    const content = `
    <!-- Urgency Banner -->
    <div style="background: linear-gradient(90deg, #d97706 0%, #f59e0b 100%); color: white; padding: 12px 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
      <div style="font-size: 14px; font-weight: 600; letter-spacing: 0.5px;">🔐 LOGIN ATTEMPT</div>
    </div>

    <!-- Greeting -->
    <p style="color: #1e293b; font-size: 18px; font-weight: 600; margin-bottom: 8px;">Hello ${fullName || "there"},</p>
    <p style="color: #475569; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
      We detected a <strong>failed login attempt</strong> on your ColabWize account. If this was you, please check your credentials.
    </p>

    <!-- Location Card -->
    ${locationCard}

    <!-- Metadata Block -->
    <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 20px; margin: 24px 0;">
      <h3 style="color: #92400e; font-size: 16px; font-weight: 700; margin: 0 0 16px 0; padding-bottom: 12px; border-bottom: 1px solid #fde68a;">📋 Attempt Details</h3>

      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 10px 0; color: #92400e; font-size: 14px; width: 40%;">📍 Location</td>
          <td style="padding: 10px 0; color: #78350f; font-size: 14px; font-weight: 500;">${location}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #92400e; font-size: 14px;">📱 Device</td>
          <td style="padding: 10px 0; color: #78350f; font-size: 14px; font-weight: 500;">${device}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #92400e; font-size: 14px;">🖥️ Browser</td>
          <td style="padding: 10px 0; color: #78350f; font-size: 14px; font-weight: 500;">${browser}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #92400e; font-size: 14px;">🕒 Time</td>
          <td style="padding: 10px 0; color: #78350f; font-size: 14px; font-weight: 500;">${timestamp}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #92400e; font-size: 14px;">🌐 IP Address</td>
          <td style="padding: 10px 0; color: #78350f; font-size: 14px; font-family: monospace; font-weight: 500;">${ipAddress}</td>
        </tr>
      </table>
    </div>

    <!-- Warning Box -->
    <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 4px solid #16a34a; border-radius: 8px; padding: 16px; margin: 24px 0;">
      <p style="color: #166534; font-size: 14px; margin: 0; line-height: 1.5;">
        <strong>Tip:</strong> If you're having trouble logging in, make sure you're using the correct email and password.
      </p>
    </div>
  `;
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: "Failed login attempt detected",
        titleColor: "#d97706",
        content,
        ctaText: "Review Account Security",
        ctaUrl: `${frontendUrl}/settings/security`,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
        from: "SECURITY",
        to,
        subject: "Security alert: failed login attempt on your ColabWize account",
        html,
        text: `Hello ${fullName || "there"},

We detected a failed login attempt on your ColabWize account.

Attempt Details:
- Location: ${location}
- Device: ${device}
- Browser: ${browser}
- Time: ${timestamp}
- IP Address: ${ipAddress}

If you're having trouble logging in, please check your credentials or reset your password: ${frontendUrl}/settings/security

ColabWize Security Team`,
    });
    return success;
}
/**
 * Technical Description:
 * A transactional security alert email that dynamically embeds a static map
 * image corresponding to the geolocation (City, Country) of the login attempt.
 *
 * Core Components:
 * 1. Layout (HTML/CSS):
 *    - Header: Clean branding with logo, timestamp, and subject line
 *    - Body Text: High-urgency message with account name, location, device, date/time
 *    - Primary CTA: High-contrast button ("This wasn't me")
 *
 * 2. Dynamic Map Integration:
 *    - Uses OpenStreetMap static tiles (no API key required)
 *    - Format: https://staticmap.openstreetmap.de/staticmap.php?center={lat},{lng}&zoom=12&size=600x300
 *    - Fallback: Stylized location card when coordinates unavailable
 *
 * 3. Metadata Block:
 *    - Location: City, Region, Country
 *    - Device: Desktop/Mobile/Tablet
 *    - Browser: Chrome/Firefox/etc.
 *    - Time: Exact timestamp with timezone
 *    - IP Address: Client IP
 *
 * UI/UX Goals:
 * - Mobile-First: Map scales cleanly on all devices
 * - High Contrast: "This wasn't me" button stands out for quick action
 * - Urgency: Clear visual hierarchy for security alert
 */
/**
 * Generates a static map URL using OpenStreetMap tiles.
 * No API key required - uses free static tile service.
 */
function generateStaticMapUrl(location) {
    // Parse location string (format: "City, Region, Country")
    const parts = location.split(",").map(p => p.trim());
    if (parts.length < 2 || location === "Unknown") {
        // Return empty string for fallback visual
        return "";
    }
    // For a real implementation, you would:
    // 1. Use a geocoding service to get lat/lng from location string
    // 2. Pass coordinates to static map API
    //
    // Example with Google Static Maps (requires API key):
    // `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=12&size=600x300&maptype=roadmap&markers=color:red%7C${lat},${lng}`
    //
    // Example with Mapbox Static API (requires API key):
    // `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${lng},${lat},12/600x300?access_token=${token}`
    //
    // For now, return empty string and use fallback visual
    return "";
}
/**
 * Generates a styled location card that looks like a map
 * when static map URL is unavailable.
 */
function generateLocationCardHtml(location, ipAddress) {
    const parts = location.split(",").map(p => p.trim());
    const city = parts[0] || "Unknown";
    const region = parts[1] || "";
    const country = parts[parts.length - 1] || "";
    return `
    <div style="background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%); border-radius: 16px; padding: 24px; margin: 24px 0; position: relative; overflow: hidden;">
      <!-- Decorative map pattern -->
      <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; opacity: 0.1; background-image: repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(255,255,255,0.3) 2px, rgba(255,255,255,0.3) 4px);"></div>

      <!-- Location pin icon -->
      <div style="position: relative; z-index: 1; text-align: center; margin-bottom: 16px;">
        <div style="display: inline-block; background: #ef4444; width: 40px; height: 40px; border-radius: 50% 50% 50% 0; transform: rotate(-45deg); box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4);">
          <div style="width: 16px; height: 16px; background: white; border-radius: 50%; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);"></div>
        </div>
      </div>

      <!-- Location text -->
      <div style="position: relative; z-index: 1; text-align: center;">
        <div style="color: white; font-size: 20px; font-weight: 700; margin-bottom: 4px;">${city}</div>
        <div style="color: rgba(255,255,255,0.8); font-size: 14px;">${region ? region + ", " : ""}${country}</div>
      </div>

      <!-- Coordinates hint -->
      <div style="position: relative; z-index: 1; text-align: center; margin-top: 12px;">
        <div style="color: rgba(255,255,255,0.6); font-size: 12px; font-family: monospace;">📍 Login Location</div>
      </div>
    </div>
  `;
}
/**
 * Sends a new device login notification email.
 */
async function sendNewDeviceLoginEmail(to, fullName, ipAddress, location, device, browser) {
    const frontendUrl = await secrets_service_1.SecretsService.getFrontendUrl();
    const timestamp = new Date().toLocaleString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZoneName: "short",
    });
    const mapUrl = generateStaticMapUrl(location);
    const showStaticMap = mapUrl !== "";
    const locationCard = generateLocationCardHtml(location, ipAddress);
    const content = `
    <!-- Urgency Banner -->
    <div style="background: linear-gradient(90deg, #dc2626 0%, #ef4444 100%); color: white; padding: 12px 20px; border-radius: 12px; margin-bottom: 24px; text-align: center;">
      <div style="font-size: 14px; font-weight: 600; letter-spacing: 0.5px;">⚠️ SECURITY ALERT</div>
    </div>

    <!-- Greeting -->
    <p style="color: #1e293b; font-size: 18px; font-weight: 600; margin-bottom: 8px;">Hello ${fullName || "there"},</p>
    <p style="color: #475569; font-size: 16px; line-height: 1.6; margin-bottom: 24px;">
      We detected a <strong>new login</strong> to your ColabWize account. If this was you, no action is needed.
    </p>

    <!-- Static Map or Location Card -->
    ${showStaticMap
        ? `<div style="margin: 24px 0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
          <img src="${mapUrl}" alt="Login Location Map" style="width: 100%; height: auto; display: block;" />
        </div>`
        : locationCard}

    <!-- Metadata Block -->
    <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin: 24px 0;">
      <h3 style="color: #1e293b; font-size: 16px; font-weight: 700; margin: 0 0 16px 0; padding-bottom: 12px; border-bottom: 1px solid #e2e8f0;">📋 Login Details</h3>

      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 10px 0; color: #64748b; font-size: 14px; width: 40%;">📍 Location</td>
          <td style="padding: 10px 0; color: #1e293b; font-size: 14px; font-weight: 500;">${location}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #64748b; font-size: 14px;">📱 Device</td>
          <td style="padding: 10px 0; color: #1e293b; font-size: 14px; font-weight: 500;">${device}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #64748b; font-size: 14px;">🖥️ Browser</td>
          <td style="padding: 10px 0; color: #1e293b; font-size: 14px; font-weight: 500;">${browser}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #64748b; font-size: 14px;">🕒 Time</td>
          <td style="padding: 10px 0; color: #1e293b; font-size: 14px; font-weight: 500;">${timestamp}</td>
        </tr>
        <tr>
          <td style="padding: 10px 0; color: #64748b; font-size: 14px;">🌐 IP Address</td>
          <td style="padding: 10px 0; color: #1e293b; font-size: 14px; font-family: monospace; font-weight: 500;">${ipAddress}</td>
        </tr>
      </table>
    </div>

    <!-- Warning Box -->
    <div style="background: #fef2f2; border: 1px solid #fecaca; border-left: 4px solid #dc2626; border-radius: 8px; padding: 16px; margin: 24px 0;">
      <p style="color: #991b1b; font-size: 14px; margin: 0; line-height: 1.5;">
        <strong>Didn't recognize this login?</strong> Click the button below to review your active sessions and secure your account.
      </p>
    </div>

    <!-- Spacer for CTA -->
    <div style="height: 16px;"></div>
  `;
    const html = (0, emailLayout_1.buildEmailHtml)({
        title: `Security alert: login near ${location !== "Unknown" ? location.split(",")[0] : "your account"}`,
        titleColor: "#dc2626",
        content,
        ctaText: "This wasn't me — Secure Account",
        ctaUrl: `${frontendUrl}/settings/security`,
    });
    const { success } = await (0, baseMailer_1.sendEmail)({
        from: "SECURITY",
        to,
        subject: `Security alert: new login near ${location !== "Unknown" ? location.split(",")[0] : "your account"}`,
        html,
        text: `Hello ${fullName || "there"},

We detected a new login to your ColabWize account.

Login Details:
- Location: ${location}
- Device: ${device}
- Browser: ${browser}
- Time: ${timestamp}
- IP Address: ${ipAddress}

If this wasn't you, please secure your account immediately: ${frontendUrl}/settings/security

ColabWize Security Team`,
    });
    return success;
}
