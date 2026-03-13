import { sendEmail } from "./baseMailer";
import { SecretsService } from "../secrets-service";

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
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px; text-align: center;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo" style="width: 180px; height: auto; margin-bottom: 15px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">${title}</h1>
        </div>
        
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">
          Hello ${fullName || "there"},
        </p>
        
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">
          ${message}
        </p>
        
        <div style="margin: 35px 0; text-align: center;">
          <a href="${frontendUrl}/dashboard" style="background-color: #1e40af; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(30, 64, 175, 0.2);">
            View in Dashboard
          </a>
        </div>
        
        <div style="border-top: 1px solid #e2e8f0; margin-top: 30px; padding-top: 20px;">
          <p style="color: #64748b; font-size: 13px; margin: 0;">
            You're receiving this because of your notification settings.
          </p>
          <p style="color: #94a3b8; font-size: 13px; margin-top: 20px;">
            © ${new Date().getFullYear()} ColabWize. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: title,
    html,
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

  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">You've Been Invited! 🚀</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello,
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          <strong>${inviterName}</strong> has invited you to join the <strong>${workspaceName}</strong> workspace on ColabWize as a <strong>${roleLabel}</strong>.
        </p>

        <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 25px 0; border: 1px solid #e2e8f0;">
          <p style="margin: 0; font-size: 14px; color: #64748b;">
            ColabWize is the leading platform for academic integrity and defensible writing. Join your team to collaborate on projects and protect your work.
          </p>
        </div>
        
        <div style="margin: 35px 0; text-align: center;">
          <a href="${acceptUrl}" style="background-color: #1e40af; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(30, 64, 175, 0.2);">
            Accept Invitation
          </a>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          This invitation will expire on <strong>${expiresAt.toLocaleDateString()} at ${expiresAt.toLocaleTimeString()}</strong>.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `Workspace Invitation: Join ${workspaceName} on ColabWize`,
    html,
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
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Workspace Access Updated</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName || "there"},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          You have been removed from the <strong>${workspaceName}</strong> workspace by <strong>${removerName}</strong>.
        </p>

        <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 25px 0; border: 1px solid #e2e8f0;">
          <p style="margin: 0; font-size: 14px; color: #64748b;">
            If you believe this was a mistake, please reach out to the workspace administrator. You will no longer have access to projects and tasks within this workspace.
          </p>
        </div>
        
        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `Workspace Update: Removed from ${workspaceName}`,
    html,
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

  const scanTypeIcons = {
    originality: "🔍",
    "ai-detection": "🤖",
    citations: "📚",
  };

  const subject = `${scanTypeIcons[scanType]} ${scanTypeLabels[scanType]} Complete - ${projectName}`;

  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">${scanTypeIcons[scanType]} ${scanTypeLabels[scanType]} Complete!</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName || "there"},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Your ${scanTypeLabels[scanType]} for <strong>"${projectName}"</strong> has been completed successfully.
        </p>
        
        <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
          <h2 style="color: #1e40af; margin-top: 0; font-size: 18px;">Results Summary</h2>
          <p style="margin: 5px 0; font-size: 16px; color: #333;">${resultSummary}</p>
        </div>
        
        <div style="margin: 30px 0; text-align: center;">
          <a href="${dashboardUrl}" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            View Full Results
          </a>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          Your academic integrity is our priority. All scan results are private and securely stored.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject,
    html,
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

  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">🎓 Your Authorship Certificate is Ready!</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName || "there"},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Your Authorship Certificate for <strong>"${projectName}"</strong> has been generated and is ready for download.
        </p>
        
        <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
          <h2 style="color: #1e40af; margin-top: 0; font-size: 18px;">Certificate Details</h2>
          <p style="margin: 5px 0;"><strong>Project:</strong> ${projectName}</p>
          <p style="margin: 5px 0;"><strong>Generated:</strong> ${new Date().toLocaleDateString()}</p>
          <p style="margin: 5px 0; color: #dc2626;"><strong>Storage:</strong> ${retentionMessage}</p>
        </div>
        
        <div style="margin: 30px 0; text-align: center;">
          <a href="${certificateUrl}" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Download Certificate
          </a>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          This certificate serves as proof of authorship with timestamped activity tracking. Store it safely for your records.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `🎓 Your Authorship Certificate is Ready - ${projectName}`,
    html,
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
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">${title}</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          ${message}
        </p>
        
        <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
          <h2 style="color: #1e40af; margin-top: 0;">Project Details</h2>
          <p style="margin: 5px 0;"><strong>Project:</strong> ${projectName}</p>
          <p style="margin: 5px 0;"><strong>Project ID:</strong> ${projectId}</p>
        </div>
        
        <div style="margin: 30px 0; text-align: center;">
          <a href="http://app.colabwize.com/dashboard/projects/${projectId}" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            View Project
          </a>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          You're receiving this email because you are collaborating on this project.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: title,
    html,
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

  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #ea580c; font-size: 24px; margin: 10px 0;">⚠️ Approaching Your Scan Limit</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName || "there"},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          You've used <strong>${scansUsed} out of ${scansLimit}</strong> scans on your <strong>${plan}</strong> plan this month. Only <strong>${remaining} scans</strong> remaining!
        </p>
        
        <div style="background-color: #fef3c7; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #f59e0b;">
          <h2 style="color: #92400e; margin-top: 0; font-size: 18px;">Usage Status</h2>
          <div style="background-color: #e5e7eb; height: 20px; border-radius: 10px; overflow: hidden; margin: 15px 0;">
            <div style="background-color: ${percentage >= 90 ? "#ef4444" : "#f59e0b"}; height: 100%; width: ${percentage}%; transition: width 0.3s;"></div>
          </div>
          <p style="margin: 5px 0; color: #78350f;"><strong>${percentage}% used</strong> - ${remaining} scans left</p>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          ${percentage >= 90 ? "Consider upgrading your plan to avoid interruptions to your academic work!" : "Upgrade now to get more scans and unlock premium features!"}
        </p>
        
        <div style="margin: 30px 0; text-align: center;">
          <a href="${upgradeUrl}" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Upgrade Your Plan
          </a>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          Your usage will reset on the 1st of next month.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `⚠️ You've Used ${percentage}% of Your Monthly Scans`,
    html,
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
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #dc2626; font-size: 24px; margin: 10px 0;">🚫 Monthly Limit Reached</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName || "there"},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          You've reached your monthly scan limit on the <strong>${plan}</strong> plan.
        </p>
        
        <div style="background-color: #fee2e2; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #dc2626;">
          <h2 style="color: #991b1b; margin-top: 0; font-size: 18px;">What This Means</h2>
          <ul style="margin: 10px 0; padding-left: 20px; color: #7f1d1d;">
            <li>You cannot run new scans until you upgrade or your limit resets</li>
            <li>Your usage will reset on <strong>${resetDate}</strong></li>
            <li>Upgrade now to continue scanning immediately</li>
          </ul>
        </div>
        
        <div style="margin: 30px 0; text-align: center;">
          <a href="${upgradeUrl}" style="background-color: #1e40af; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 16px;">
            Upgrade Now
          </a>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          All your existing results remain available. Upgrade to continue protecting your work.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `🚫 Monthly Scan Limit Reached - ${plan} Plan`,
    html,
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

  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px; text-align: center;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo" style="width: 180px; height: auto; margin-bottom: 15px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">New Research Matches</h1>
        </div>
        
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">
          Hello ${fullName || "there"},
        </p>
        
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">
          We found <strong>${matchCount}</strong> new research papers matching your alert for: <span style="color: #1e40af; font-weight: bold;">"${query}"</span>.
        </p>

        <div style="margin: 30px 0;">
          ${resultsHtml}
        </div>
        
        <div style="margin: 35px 0; text-align: center;">
          <a href="${await SecretsService.getFrontendUrl()}/dashboard" style="background-color: #1e40af; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            View All Matches
          </a>
        </div>
        
        <div style="border-top: 1px solid #e2e8f0; margin-top: 30px; padding-top: 20px;">
          <p style="color: #64748b; font-size: 13px; margin: 0;">
            You requested ${query} alerts. You can manage them in your dashboard.
          </p>
          <p style="color: #94a3b8; font-size: 13px; margin-top: 20px;">
            © ${new Date().getFullYear()} ColabWize. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `🔔 New Research Found: ${query}`,
    html,
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
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">${title}</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          ${message}
        </p>
        
        ${
          data
            ? `<div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
            <h2 style="color: #1e40af; margin-top: 0;">Analytics Data</h2>
            <pre style="white-space: pre-wrap; word-wrap: break-word; background-color: #fff; padding: 10px; border-radius: 4px; font-size: 14px;">${JSON.stringify(data, null, 2)}</pre>
          </div>`
            : ""
        }
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          You're receiving this email because you have analytics notifications enabled.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: title,
    html,
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
): Promise<boolean> {
  const fs = require("fs");
  const reportBuffer = fs.readFileSync(reportPath);

  const periodLabels = {
    week: "Weekly",
    month: "Monthly",
    year: "Yearly",
  };

  const subject = `ColabWize ${periodLabels[period]} Analytics Report`;

  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">${periodLabels[period]} Analytics Report</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Your ${periodLabels[period].toLowerCase()} analytics report is now available. Please find the attached PDF document.
        </p>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          You're receiving this email because you have automated analytics reports enabled.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject,
    html,
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
  const salesHtml = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">New Institutional Plan Request</h1>
        </div>
        
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
      </div>
    </div>
  `;

  await sendEmail({
    from: "NOTIFICATIONS",
    to: "sales@colabwize.com",
    subject: `New Institutional Plan Request - ${institutionName}`,
    html: salesHtml,
  });

  // 2. Send confirmation to requester
  const confirmationHtml = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Request Received</h1>
        </div>
        
        <p>Hello ${contactName},</p>
        <p>Thank you for your interest in ColabWize's institutional plan. We will contact you within 1 business day.</p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to: contactEmail,
    subject: "ColabWize Institutional Plan Request Received",
    html: confirmationHtml,
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
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #ea580c; font-size: 24px; margin: 10px 0;">⏰ Certificates Expiring Soon</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName || "there"},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          You have <strong>${certificateCount} authorship certificate${certificateCount > 1 ? "s" : ""}</strong> that will be automatically deleted on <strong>${expirationDate}</strong>.
        </p>
        
        <div style="margin: 30px 0; text-align: center;">
          <a href="${downloadUrl}" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
            Download Certificates
          </a>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          Free: 7 days | Student: 30 days | Researcher: Unlimited
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "NOTIFICATIONS",
    to,
    subject: `⏰ ${certificateCount} Certificate${certificateCount > 1 ? "s" : ""} Expiring Soon`,
    html,
  });

  return success;
}
