import { sendEmail } from "./baseMailer";
import { SecretsService } from "../secrets-service";

/**
 * Sends an OTP email for account verification.
 */
export async function sendOTPEmail(
  to: string,
  otp: string,
  fullName: string = "",
): Promise<boolean> {
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Verify Your Account</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName || "there"},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Thank you for signing up with ColabWize. You're one step closer to protecting your academic work. Please use the following code to verify your account:
        </p>
        
        <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: center;">
          <p style="font-size: 32px; font-weight: bold; color: #1e40af; letter-spacing: 4px; margin: 0;">
            ${otp}
          </p>
          <p style="color: #666666; font-size: 14px; margin-top: 10px;">
            This code will expire in 10 minutes
          </p>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          If you did not request this code, please disregard this email. Your academic integrity is important to us.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize - Your Academic Integrity Partner
        </p>
        
        <p style="color: #999999; font-size: 12px; margin: 0;">
          &copy; ${new Date().getFullYear()} ColabWize. All rights reserved.
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "VERIFY",
    to,
    subject: "Verify your ColabWize account",
    html,
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
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Welcome to ColabWize! 🚀</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName || "there"},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Welcome to the leading platform for academic integrity and defensible writing. We're thrilled to have you on board!
        </p>

        <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 25px 0; border: 1px solid #e2e8f0;">
          <h2 style="color: #1e40af; font-size: 18px; margin-top: 0;">Your Submission Shield Includes:</h2>
          
          <div style="margin-bottom: 15px;">
            <h3 style="margin: 0 0 5px 0; font-size: 16px; color: #334155;">🔍 Explainable Originality Map</h3>
            <p style="margin: 0; font-size: 14px; color: #64748b;">See exactly where your content matches external sources.</p>
          </div>

          <div style="margin-bottom: 15px;">
            <h3 style="margin: 0 0 5px 0; font-size: 16px; color: #334155;">🤖 Safe AI Integrity Assistant</h3>
            <p style="margin: 0; font-size: 14px; color: #64748b;">Ensure responsible AI usage with real-time guidance and proper attribution.</p>
          </div>

          <div style="margin-bottom: 15px;">
            <h3 style="margin: 0 0 5px 0; font-size: 16px; color: #334155;">📚 Citation Confidence Auditor</h3>
            <p style="margin: 0; font-size: 14px; color: #64748b;">Verify citation quality and detect hallucinated references.</p>
          </div>

          <div>
            <h3 style="margin: 0 0 5px 0; font-size: 16px; color: #334155;">🎓 Authorship Certificates</h3>
            <p style="margin: 0; font-size: 14px; color: #64748b;">Generate timestamped proof of your writing process.</p>
          </div>
        </div>
        
        <div style="margin: 35px 0; text-align: center;">
          <a href="${frontendUrl}/dashboard" style="background-color: #1e40af; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(30, 64, 175, 0.2);">
            Go to Dashboard
          </a>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          Ready to start? <a href="${frontendUrl}/dashboard/documents" style="color: #1e40af; text-decoration: none;">dashboard/documents your first document</a> now to run a scan.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team - Your Academic Integrity Partner
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "VERIFY",
    to,
    subject: "🚀 Welcome to ColabWize - Let's Protect Your Work!",
    html,
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
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; padding: 20px;">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px; text-align: center;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo" style="width: 180px; height: auto; margin-bottom: 15px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Password Reset Request</h1>
        </div>
        
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">
          Hello ${fullName || "there"},
        </p>
        
        <p style="color: #475569; font-size: 16px; line-height: 1.6;">
          We received a request to reset your password for your ColabWize account. Click the button below to choose a new password and get back to your work:
        </p>
        
        <div style="margin: 35px 0; text-align: center;">
          <a href="${resetLink}" style="background-color: #1e40af; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(30, 64, 175, 0.2);">
            Reset Password
          </a>
        </div>
        
        <p style="color: #475569; font-size: 14px; line-height: 1.6;">
          If you didn't request a password reset, you can safely ignore this email. Your account remains secure.
        </p>
        
        <div style="border-top: 1px solid #e2e8f0; margin-top: 30px; padding-top: 20px;">
          <p style="color: #64748b; font-size: 13px; margin: 0;">
            This link will expire in 1 hour for security reasons.
          </p>
          <p style="color: #94a3b8; font-size: 13px; margin-top: 20px;">
            © ${new Date().getFullYear()} ColabWize. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "SECURITY",
    to,
    subject: "🔒 Reset your ColabWize password",
    html,
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
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo" style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">2FA Successfully Enabled</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName || "there"},
        </p>
        
        <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="color: #065f46; font-size: 16px; margin: 0; font-weight: bold;">
            ✅ Two-factor authentication (2FA) is now active for your account.
          </p>
        </div>

        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Your account is now more secure. When you sign in, you'll be required to enter a code from your authenticator app.
        </p>

        <h3 style="color: #1e40af; font-size: 18px; margin-top: 30px;">🔐 Important: Keep it Secure</h3>
        <ul style="color: #666666; font-size: 15px; line-height: 1.6; padding-left: 20px;">
          <li style="margin-bottom: 10px;"><strong>Backup Codes:</strong> Ensure you have saved your recovery codes in a safe place (like a password manager). These are the only way to access your account if you lose your phone.</li>
          <li style="margin-bottom: 10px;"><strong>Lost Device:</strong> If you lose your device, use a backup code to login immediately and disable 2FA, then re-enable it on a new device.</li>
          <li style="margin-bottom: 10px;"><strong>Don't Share:</strong> Never share your verification codes with anyone, even support agents.</li>
        </ul>
        
        <div style="margin: 35px 0; text-align: center;">
          <a href="${frontendUrl}/dashboard/settings" style="background-color: #1e40af; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(30, 64, 175, 0.2);">
            Manage Security Settings
          </a>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          You received this email because 2FA was enabled on your ColabWize account.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Security Team
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "SECURITY",
    to,
    subject: "🔒 Two-Factor Authentication Enabled",
    html,
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

  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">${subject}</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          ${bodyMessage}
        </p>
        
        <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: center;">
          <p style="font-size: 32px; font-weight: bold; color: #1e40af; letter-spacing: 4px; margin: 0;">
            ${otp}
          </p>
          <p style="color: #666666; font-size: 14px; margin-top: 10px;">
            This code will expire in 10 minutes
          </p>
        </div>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          If you did not request this change, please disregard this email. The code will remain active for 10 minutes.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize - Your Academic Integrity Partner
        </p>
        
        <p style="color: #999999; font-size: 12px; margin: 0;">
          &copy; ${new Date().getFullYear()} ColabWize. All rights reserved.
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "VERIFY",
    to,
    subject,
    html,
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
  const html = `
    <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
      <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
        <div style="margin-bottom: 30px;">
          <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
          <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Account Deletion Confirmation</h1>
        </div>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Hello ${fullName || "there"},
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          Your ColabWize account has been successfully deleted. All your data has been permanently removed from our systems. 
        </p>
        
        <p style="color: #666666; font-size: 16px; line-height: 1.6;">
          We're sorry to see you go. If you have any feedback, we'd love to hear it.
        </p>
        
        <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
          Thank you for using ColabWize.
        </p>

        <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
          ColabWize Team
        </p>
      </div>
    </div>
  `;

  const { success } = await sendEmail({
    from: "SECURITY",
    to,
    subject: "ColabWize Account Deletion Confirmation",
    html,
  });

  return success;
}
