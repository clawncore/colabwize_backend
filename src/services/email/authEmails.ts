import { sendEmail } from "./baseMailer";
import { SecretsService } from "../secrets-service";
import { buildEmailHtml } from "./emailLayout";

/**
 * Sends an OTP email for account verification.
 */
export async function sendOTPEmail(
  to: string,
  otp: string,
  fullName: string = "",
): Promise<boolean> {
  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>Thank you for signing up with ColabWize. You're one step closer to protecting your academic work. Please use the following code to verify your account:</p>
    <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: center;">
      <p style="font-size: 32px; font-weight: bold; color: #1e40af; letter-spacing: 4px; margin: 0;">${otp}</p>
      <p style="color: #666666; font-size: 14px; margin-top: 10px;">This code will expire in 10 minutes</p>
    </div>
    <p style="font-size: 14px;">If you did not request this code, please disregard this email. Your academic integrity is important to us.</p>
  `;

  const html = buildEmailHtml({
    title: "Verify Your Account",
    content,
  });

  const { success } = await sendEmail({
    from: "VERIFY",
    to,
    subject: "Your verification code for ColabWize",
    html,
    text: `Hello ${fullName || "there"},\n\nYour verification code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends a welcome email to a new user.
 */
export async function sendWelcomeEmail(
  to: string,
  fullName: string = "",
): Promise<boolean> {
  const frontendUrl = await SecretsService.getFrontendUrl();
  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>Welcome to the leading platform for academic integrity and defensible writing. We're thrilled to have you on board!</p>

    <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 25px 0; border: 1px solid #e2e8f0;">
      <h2 style="color: #1e40af; font-size: 18px; margin-top: 0;">Your Submission Shield Includes:</h2>
      
      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 5px 0; font-size: 16px; color: #334155;">Explainable Originality Map</h3>
        <p style="margin: 0; font-size: 14px; color: #64748b;">See exactly where your content matches external sources.</p>
      </div>

      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 5px 0; font-size: 16px; color: #334155;">Defensible Writing Workspace</h3>
        <p style="margin: 0; font-size: 14px; color: #64748b;">Draft your documents securely with full version history and playback capabilities.</p>
      </div>

      <div style="margin-bottom: 15px;">
        <h3 style="margin: 0 0 5px 0; font-size: 16px; color: #334155;">Citation Confidence Auditor</h3>
        <p style="margin: 0; font-size: 14px; color: #64748b;">Verify citation quality and detect hallucinated references.</p>
      </div>

      <div>
        <h3 style="margin: 0 0 5px 0; font-size: 16px; color: #334155;">Authorship Certificates</h3>
        <p style="margin: 0; font-size: 14px; color: #64748b;">Generate timestamped proof of your writing process.</p>
      </div>
    </div>
    
    <p style="font-size: 14px;">Ready to start? <a href="${frontendUrl}/dashboard/documents" style="color: #1e40af; text-decoration: none;">dashboard/documents your first document</a> now to run a scan.</p>
  `;

  const html = buildEmailHtml({
    title: "Welcome to ColabWize!",
    content,
    ctaText: "Go to Dashboard",
    ctaUrl: `${frontendUrl}/dashboard`,
  });

  const { success } = await sendEmail({
    from: "WELCOME",
    to,
    subject: "Welcome to ColabWize - Let's Protect Your Work!",
    html,
    text: `Hello ${fullName || "there"},\n\nWelcome to ColabWize! Go to your dashboard to get started: ${frontendUrl}/dashboard\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends a password reset email.
 */
export async function sendPasswordResetEmail(
  to: string,
  resetLink: string,
  fullName: string = "",
): Promise<boolean> {
  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>We received a request to reset your password for your ColabWize account. Click the button below to choose a new password and get back to your work:</p>
    <p style="font-size: 14px;">If you didn't request a password reset, you can safely ignore this email. Your account remains secure.</p>
    <p style="font-size: 13px; color: #64748b;">This link will expire in 1 hour for security reasons.</p>
  `;

  const html = buildEmailHtml({
    title: "Password Reset Request",
    content,
    ctaText: "Reset Password",
    ctaUrl: resetLink,
  });

  const { success } = await sendEmail({
    from: "SECURITY",
    to,
    subject: "Reset your ColabWize password",
    html,
    text: `Hello ${fullName || "there"},\n\nReset your password by following this link: ${resetLink}\n\nThis link expires in 1 hour.\n\nColabWize Security`,
  });

  return success;
}

/**
 * Sends a 2FA enabled confirmation email.
 */
export async function send2FAEnabledEmail(
  to: string,
  fullName: string = "",
): Promise<boolean> {
  const frontendUrl = await SecretsService.getFrontendUrl();
  const content = `
    <p>Hello ${fullName || "there"},</p>
    
    <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; padding: 20px; border-radius: 8px; margin: 20px 0;">
      <p style="color: #065f46; font-size: 16px; margin: 0; font-weight: bold;">
        ✅ Two-factor authentication (2FA) is now active for your account.
      </p>
    </div>

    <p>Your account is now more secure. When you sign in, you'll be required to enter a code from your authenticator app.</p>

    <h3 style="color: #1e40af; font-size: 18px; margin-top: 30px;">🔐 Important: Keep it Secure</h3>
    <ul style="padding-left: 20px;">
      <li style="margin-bottom: 10px;"><strong>Backup Codes:</strong> Ensure you have saved your recovery codes in a safe place.</li>
      <li style="margin-bottom: 10px;"><strong>Lost Device:</strong> If you lose your device, use a backup code to login.</li>
      <li style="margin-bottom: 10px;"><strong>Don't Share:</strong> Never share your verification codes with anyone.</li>
    </ul>
    
    <p style="font-size: 14px;">You received this email because 2FA was enabled on your ColabWize account.</p>
  `;

  const html = buildEmailHtml({
    title: "Two-Factor Authentication Successfully Enabled",
    content,
    ctaText: "Manage Security Settings",
    ctaUrl: `${frontendUrl}/dashboard/settings`,
    footerText: "ColabWize Security Team",
  });

  const { success } = await sendEmail({
    from: "SECURITY",
    to,
    subject: "Two-Factor Authentication Enabled",
    html,
    text: `Hello ${fullName || "there"},\n\nTwo-factor authentication (2FA) is now active for your account.\n\nColabWize Security`,
  });

  return success;
}

/**
 * Sends an OTP for profile updates (e.g., email change).
 */
export async function sendProfileUpdateOTPEmail(
  to: string,
  otp: string,
  isEmailChange: boolean = false,
): Promise<boolean> {
  const subject = isEmailChange
    ? "Verify your email change request"
    : "Verify your profile update";

  const bodyMessage = isEmailChange
    ? "You have requested to change your email address. Please enter the following code to confirm this change."
    : "You have requested to update your profile information. Please enter the following code to confirm these changes.";

  const content = `
    <p>${bodyMessage}</p>
    <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: center;">
      <p style="font-size: 32px; font-weight: bold; color: #1e40af; letter-spacing: 4px; margin: 0;">${otp}</p>
      <p style="color: #666666; font-size: 14px; margin-top: 10px;">This code will expire in 10 minutes</p>
    </div>
    <p style="font-size: 14px;">If you did not request this change, please disregard this email. The code will remain active for 10 minutes.</p>
  `;

  const html = buildEmailHtml({
    title: subject,
    content,
  });

  const { success } = await sendEmail({
    from: "VERIFY",
    to,
    subject,
    html,
    text: `${bodyMessage}\n\nYour code is: ${otp}\n\nThis code will expire in 10 minutes.\n\nColabWize Team`,
  });

  return success;
}

/**
 * Sends an account deletion confirmation email.
 */
export async function sendAccountDeletionEmail(
  to: string,
  fullName: string = "",
): Promise<boolean> {
  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>Your ColabWize account has been successfully deleted. All your data has been permanently removed from our systems.</p>
    <p>We're sorry to see you go. If you have any feedback, we'd love to hear it.</p>
    <p style="font-size: 14px;">Thank you for using ColabWize.</p>
  `;

  const html = buildEmailHtml({
    title: "Account Deletion Confirmation",
    content,
  });

  const { success } = await sendEmail({
    from: "SECURITY",
    to,
    subject: "ColabWize Account Deletion Confirmation",
    html,
    text: `Hello ${fullName || "there"},\n\nYour ColabWize account has been successfully deleted.\n\nThank you for using ColabWize.`,
  });

  return success;
}

/**
 * Sends an account activity alert (e.g., new login).
 */
export async function sendAccountActivityAlertEmail(
  to: string,
  fullName: string = "",
  deviceInfo: string = "an unrecognized device",
  time: string = new Date().toLocaleString(),
): Promise<boolean> {
  const frontendUrl = await SecretsService.getFrontendUrl();
  const content = `
    <p>Hello ${fullName || "there"},</p>
    <p>We noticed a new login to your ColabWize account from <strong>${deviceInfo}</strong> on <strong>${time}</strong>.</p>
    <p>If this was you, no further action is required.</p>
    <p>If you don't recognize this activity, please secure your account immediately by resetting your password.</p>
  `;

  const html = buildEmailHtml({
    title: "New Login Detected",
    content,
    ctaText: "Review Account Security",
    ctaUrl: `${frontendUrl}/dashboard/settings`,
    footerText: "ColabWize Security Team",
  });

  const { success } = await sendEmail({
    from: "SECURITY",
    to,
    subject: "New login detected on your ColabWize account",
    html,
    text: `Hello ${fullName || "there"},\n\nWe noticed a new login from ${deviceInfo} at ${time}.\n\nIf this wasn't you, secure your account immediately.\n\nColabWize Security`,
  });

  return success;
}
