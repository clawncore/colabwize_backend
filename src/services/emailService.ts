import { Resend } from "resend";
import { SecretsService } from "./secrets-service";

// Initialize Resend client
let resend: Resend | null = null;

// Initialize Resend client with API key from secrets
const initializeResend = async () => {
  const resendApiKey = await SecretsService.getSecret("RESEND_API_KEY");

  console.log(
    "Initializing Resend client with API key:",
    resendApiKey ? "[REDACTED]" : "MISSING"
  );

  if (!resendApiKey) {
    console.error("RESEND_API_KEY is not set in environment variables");
    return null;
  }

  resend = new Resend(resendApiKey);

  // Test Resend client initialization
  try {
    console.log("Resend client initialized:", !!resend);
  } catch (error) {
    console.error("Error initializing Resend client:", error);
  }

  return resend;
};

// Initialize at startup
initializeResend();

export class EmailService {
  // Send OTP via email using Resend
  static async sendOTPEmail(
    to: string,
    otp: string,
    fullName: string = ""
  ): Promise<boolean> {
    try {
      // Validate inputs
      if (!to) {
        console.error("Email address is required");
        return false;
      }

      if (!otp) {
        console.error("OTP is required");
        return false;
      }

      console.log("Attempting to send OTP email via Resend:", {
        to,
        fullName,
        timestamp: new Date().toISOString(),
      });

      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data, error } = await resend.emails.send({
        from: "ColabWize <noreply@email.colabwize.com>",
        to,
        subject: "Verify your ColabWize sign-up",
        html: `
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
                &copy; 2024 ColabWize. All rights reserved.
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error("Resend OTP email error:", {
          error,
          to,
          fullName,
          timestamp: new Date().toISOString(),
        });

        // Provide more specific error messages for common issues
        if (error.message && error.message.includes("domain is not verified")) {
          console.error(
            "DOMAIN VERIFICATION ISSUE: You need to verify your domain (colabwize.com) in your Resend dashboard: https://resend.com/domains"
          );
        }

        return false;
      }

      console.log("OTP email sent successfully via Resend", {
        to,
        fullName,
        messageId: data?.id,
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      console.error("Error sending OTP email via Resend:", {
        error,
        to,
        fullName,
        timestamp: new Date().toISOString(),
      });
      return false;
    }
  }

  // Send welcome email
  static async sendWelcomeEmail(
    to: string,
    fullName: string = ""
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data, error } = await resend.emails.send({
        from: "ColabWize <welcome@email.colabwize.com>",
        to,
        subject: "🚀 Welcome to ColabWize - Let's Protect Your Work!",
        html: `
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
                <a href="${await SecretsService.getFrontendUrl()}/dashboard" style="background-color: #1e40af; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(30, 64, 175, 0.2);">
                  Go to Dashboard
                </a>
              </div>
              
              <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
                Ready to start? <a href="${await SecretsService.getFrontendUrl()}/dashboard/documents" style="color: #1e40af; text-decoration: none;">dashboard/documents your first document</a> now to run a scan.
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team - Your Academic Integrity Partner
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error("Resend welcome email error:", error);
        return false;
      }

      console.log("Welcome email sent successfully via Resend", {
        to,
        fullName,
        messageId: data?.id,
        timestamp: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      console.error("Error sending welcome email via Resend:", error);
      return false;
    }
  }

  // Send password reset email
  static async sendPasswordResetEmail(
    to: string,
    resetLink: string,
    fullName: string = ""
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data, error } = await resend.emails.send({
        from: "ColabWize <noreply@email.colabwize.com>",
        to,
        subject: "🔒 Reset your ColabWize password",
        html: `
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
        `,
      });

      if (error) {
        console.error("Resend password reset email error:", error);
        return false;
      }

      console.log("Password reset email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error("Error sending password reset email via Resend:", error);
      return false;
    }
  }

  // Send notification email
  static async sendNotificationEmail(
    to: string,
    fullName: string,
    title: string,
    message: string,
    type: string
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data, error } = await resend.emails.send({
        from: "ColabWize <notifications@email.colabwize.com>",
        to,
        subject: title,
        html: `
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
                <a href="${await SecretsService.getFrontendUrl()}/dashboard" style="background-color: #1e40af; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(30, 64, 175, 0.2);">
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
        `,
      });

      if (error) {
        console.error("Resend notification email error:", error);
        return false;
      }

      console.log("Notification email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error("Error sending notification email via Resend:", error);
      return false;
    }
  }

  // Send profile update OTP email
  static async sendProfileUpdateOTPEmail(
    to: string,
    otp: string,
    isEmailChange: boolean = false
  ): Promise<boolean> {
    try {
      const subject = isEmailChange
        ? "Verify your email change request"
        : "Verify your profile update";

      const bodyMessage = isEmailChange
        ? "You have requested to change your email address. Please enter the following code to confirm this change."
        : "You have requested to update your profile information. Please enter the following code to confirm these changes.";

      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data, error } = await resend.emails.send({
        from: "ColabWize <noreply@email.colabwize.com>",
        to,
        subject,
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
              <div style="margin-bottom: 30px;">
                <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
                <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">${subject}</h1>
              </div>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                ${bodyMessage}
              </p>
              
              <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0;">
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
                ColabWize, an effortless identity solution with all the features you need.
              </p>
              
              <p style="color: #999999; font-size: 12px; margin: 0;">
                &copy; 2024 ColabWize. All rights reserved.
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error("Resend profile update OTP email error:", error);
        return false;
      }

      console.log("Profile update OTP email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error(
        "Error sending profile update OTP email via Resend:",
        error
      );
      return false;
    }
  }

  // Send subscription confirmation email
  static async sendSubscriptionConfirmationEmail(
    to: string,
    fullName: string,
    planName: string,
    amount: number,
    nextBillingDate: string,
    transactionId: string
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data, error } = await resend.emails.send({
        from: "ColabWize <billing@email.colabwize.com>",
        to,
        subject: `ColabWize ${planName} Plan Subscription Confirmed`,
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
              <div style="margin-bottom: 30px;">
                <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
                <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Subscription Confirmed</h1>
              </div>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                Hello ${fullName},
              </p>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                Thank you for subscribing to ColabWize ${planName} plan! You're now one step closer to protecting your academic work and ensuring your submissions are defensible.
              </p>
              
              <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
                <h2 style="color: #1e40af; margin-top: 0;">Subscription Details</h2>
                <p style="margin: 5px 0;"><strong>Plan:</strong> ${planName}</p>
                <p style="margin: 5px 0;"><strong>Amount:</strong> $${amount.toFixed(2)}</p>
                <p style="margin: 5px 0;"><strong>Next Billing Date:</strong> ${nextBillingDate}</p>
                <p style="margin: 5px 0;"><strong>Transaction ID:</strong> ${transactionId}</p>
              </div>
              
              <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
                You can manage your subscription in your account settings. Your academic integrity is our priority.
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team - Your Academic Integrity Partner
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error("Resend subscription confirmation email error:", error);
        return false;
      }

      console.log(
        "Subscription confirmation email sent successfully via Resend"
      );
      return true;
    } catch (error) {
      console.error(
        "Error sending subscription confirmation email via Resend:",
        error
      );
      return false;
    }
  }

  // Send payment success email
  static async sendPaymentSuccessEmail(
    to: string,
    fullName: string,
    planName: string,
    amount: number,
    transactionId: string
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data, error } = await resend.emails.send({
        from: "ColabWize <billing@email.colabwize.com>",
        to,
        subject: `ColabWize Payment Successful - $${amount.toFixed(2)}`,
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
              <div style="margin-bottom: 30px;">
                <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
                <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Payment Successful</h1>
              </div>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                Hello ${fullName},
              </p>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                Your payment of $${amount.toFixed(2)} for the ${planName} plan has been processed successfully. You're now one step closer to protecting your academic work and ensuring your submissions are defensible.
              </p>
              
              <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
                <h2 style="color: #1e40af; margin-top: 0;">Payment Details</h2>
                <p style="margin: 5px 0;"><strong>Plan:</strong> ${planName}</p>
                <p style="margin: 5px 0;"><strong>Amount:</strong> $${amount.toFixed(2)}</p>
                <p style="margin: 5px 0;"><strong>Transaction ID:</strong> ${transactionId}</p>
              </div>
              
              <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
                Thank you for choosing ColabWize! Your academic integrity is our priority.
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team - Your Academic Integrity Partner
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error("Resend payment success email error:", error);
        return false;
      }

      console.log("Payment success email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error("Error sending payment success email via Resend:", error);
      return false;
    }
  }

  // Send payment failed email
  static async sendPaymentFailedEmail(
    to: string,
    fullName: string,
    planName: string,
    amount: number
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data, error } = await resend.emails.send({
        from: "ColabWize <billing@email.colabwize.com>",
        to,
        subject: `ColabWize Payment Failed - $${amount.toFixed(2)}`,
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
              <div style="margin-bottom: 30px;">
                <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
                <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Payment Failed</h1>
              </div>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                Hello ${fullName},
              </p>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                We're sorry, but your payment of $${amount.toFixed(2)} for the ${planName} plan has failed. We want to ensure you can continue protecting your academic work.
              </p>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                Please update your payment method in your account settings to continue using ColabWize and keep your submissions safe.
              </p>
              
              <div style="margin: 30px 0;">
                <a href="http://app.colabwize.com/dashboard/billing" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                  Update Payment Method
                </a>
              </div>
              
              <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
                If you need assistance, please contact our support team. Your academic integrity is important to us.
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team - Your Academic Integrity Partner
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error("Resend payment failed email error:", error);
        return false;
      }

      console.log("Payment failed email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error("Error sending payment failed email via Resend:", error);
      return false;
    }
  }

  // Send invoice available email
  static async sendInvoiceAvailableEmail(
    to: string,
    fullName: string,
    planName: string,
    amount: number,
    invoiceUrl: string
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data, error } = await resend.emails.send({
        from: "ColabWize <billing@email.colabwize.com>",
        to,
        subject: `ColabWize Invoice Available - $${amount.toFixed(2)}`,
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
              <div style="margin-bottom: 30px;">
                <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
                <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Invoice Available</h1>
              </div>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                Hello ${fullName},
              </p>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                Your invoice for $${amount.toFixed(2)} for the ${planName} plan is now available. We appreciate your commitment to protecting your academic work with ColabWize.
              </p>
              
              <div style="margin: 30px 0;">
                <a href="${invoiceUrl}" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                  View Invoice
                </a>
              </div>
              
              <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
                Thank you for choosing ColabWize! Your academic integrity is our priority.
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team - Your Academic Integrity Partner
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error("Resend invoice available email error:", error);
        return false;
      }

      console.log("Invoice available email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error("Error sending invoice available email via Resend:", error);
      return false;
    }
  }

  // Send analytics notification email
  static async sendAnalyticsNotificationEmail(
    to: string,
    fullName: string,
    title: string,
    message: string,
    data?: any
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data: emailData, error } = await resend.emails.send({
        from: "ColabWize <analytics@email.colabwize.com>",
        to,
        subject: title,
        html: `
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
                You're receiving this email because you have analytics notifications enabled in your ColabWize settings. Your academic integrity is important to us.
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team - Your Academic Integrity Partner
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error("Resend analytics notification email error:", error);
        return false;
      }

      console.log("Analytics notification email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error(
        "Error sending analytics notification email via Resend:",
        error
      );
      return false;
    }
  }

  // Send analytics report email with attachment
  static async sendAnalyticsReportEmail(
    to: string,
    fullName: string,
    period: "week" | "month" | "year",
    reportPath: string,
    reportFileName: string
  ): Promise<boolean> {
    try {
      // Read the PDF report file
      const fs = require("fs");
      const reportBuffer = fs.readFileSync(reportPath);

      const periodLabels = {
        week: "Weekly",
        month: "Monthly",
        year: "Yearly",
      };

      const subject = `ColabWize ${periodLabels[period]} Analytics Report`;

      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data, error } = await resend.emails.send({
        from: "ColabWize <analytics@email.colabwize.com>",
        to,
        subject,
        html: `
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
                Your ${periodLabels[period].toLowerCase()} analytics report is now available. Please find the attached PDF document with your detailed analytics on how you're protecting your academic work.
              </p>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                This report includes insights on your writing activity, feature usage, productivity trends, and personalized recommendations to enhance your academic integrity.
              </p>
              
              <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
                You're receiving this email because you have automated analytics reports enabled in your ColabWize settings. Your academic integrity is important to us.
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team - Your Academic Integrity Partner
              </p>
            </div>
          </div>
        `,
        attachments: [
          {
            filename: reportFileName,
            content: reportBuffer,
          },
        ],
      });

      if (error) {
        console.error("Resend analytics report email error:", error);
        return false;
      }

      console.log("Analytics report email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error("Error sending analytics report email via Resend:", error);
      return false;
    }
  }

  // Send collaboration notification email
  static async sendCollaborationNotificationEmail(
    to: string,
    fullName: string,
    title: string,
    message: string,
    projectId: string,
    projectName: string
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data, error } = await resend.emails.send({
        from: "ColabWize <collaboration@email.colabwize.com>",
        to,
        subject: title,
        html: `
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
              
              <div style="margin: 30px 0;">
                <a href="http://app.colabwize.com/dashboard/projects/${projectId}" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                  View Project
                </a>
              </div>
              
              <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
                You're receiving this email because you are collaborating on this project. Your academic integrity is important to us.
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team - Your Academic Integrity Partner
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error("Resend collaboration notification email error:", error);
        return false;
      }

      console.log(
        "Collaboration notification email sent successfully via Resend"
      );
      return true;
    } catch (error) {
      console.error(
        "Error sending collaboration notification email via Resend:",
        error
      );
      return false;
    }
  }

  // Send account deletion confirmation email
  static async sendAccountDeletionEmail(
    to: string,
    fullName: string = ""
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data, error } = await resend.emails.send({
        from: "ColabWize <noreply@email.colabwize.com>",
        to,
        subject: "ColabWize Account Deletion Confirmation",
        html: `
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
                Your ColabWize account has been successfully deleted. All your data has been permanently removed from our systems. We hope you found value in protecting your academic work during your time with us.
              </p>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                We're sorry to see you go. If you have any feedback about your experience with ColabWize, we'd love to hear it.
              </p>
              
              <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
                Thank you for using ColabWize. Your academic integrity is important to us.
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team - Your Academic Integrity Partner
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error("Resend account deletion email error:", error);
        return false;
      }

      console.log("Account deletion email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error("Error sending account deletion email via Resend:", error);
      return false;
    }
  }

  // Send institutional plan request email
  static async sendInstitutionalPlanRequestEmail({
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
    try {
      // Send notification to sales team
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data: salesData, error: salesError } = await resend.emails.send({
        from: "ColabWize <noreply@email.colabwize.com>",
        to: "sales@colabwize.com", // Replace with actual sales email
        subject: `New Institutional Plan Request - ${institutionName}`,
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
              <div style="margin-bottom: 30px;">
                <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">New Institutional Plan Request</h1>
              </div>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                A new institutional plan request has been submitted with the following details:
              </p>
              
              <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
                <p style="color: #666666; font-size: 16px; margin: 10px 0;">
                  <strong>Institution:</strong> ${institutionName}
                </p>
                <p style="color: #666666; font-size: 16px; margin: 10px 0;">
                  <strong>Contact Person:</strong> ${contactName}
                </p>
                <p style="color: #666666; font-size: 16px; margin: 10px 0;">
                  <strong>Contact Email:</strong> ${contactEmail}
                </p>
                <p style="color: #666666; font-size: 16px; margin: 10px 0;">
                  <strong>Contact Phone:</strong> ${contactPhone}
                </p>
                <p style="color: #666666; font-size: 16px; margin: 10px 0;">
                  <strong>Institution Type:</strong> ${institutionType}
                </p>
                <p style="color: #666666; font-size: 16px; margin: 10px 0;">
                  <strong>Estimated Users:</strong> ${estimatedUsers}
                </p>
                ${
                  department
                    ? `<p style="color: #666666; font-size: 16px; margin: 10px 0;">
                  <strong>Department:</strong> ${department}
                </p>`
                    : ""
                }
                ${
                  message
                    ? `<p style="color: #666666; font-size: 16px; margin: 10px 0;">
                  <strong>Message:</strong> ${message}
                </p>`
                    : ""
                }
              </div>
              
              <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
                Please follow up with this potential customer within 1 business day.
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Sales Notification
              </p>
            </div>
          </div>
        `,
      });

      if (salesError) {
        console.error(
          "Resend institutional plan request email error:",
          salesError
        );
        return false;
      }

      // Send confirmation to requester
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data: confirmationData, error: confirmationError } =
        await resend.emails.send({
          from: "ColabWize <noreply@email.colabwize.com>",
          to: contactEmail,
          subject: "ColabWize Institutional Plan Request Received",
          html: `
          <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
              <div style="margin-bottom: 30px;">
                <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">Institutional Plan Request Received</h1>
              </div>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                Hello ${contactName},
              </p>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                Thank you for your interest in ColabWize's institutional plan. We have received your request for ${institutionName} and will contact you within 1 business day to discuss your needs.
              </p>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                In the meantime, if you have any urgent questions, please feel free to contact our sales team at sales@colabwize.com.
              </p>
              
              <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
                We look forward to working with you!
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team
              </p>
            </div>
          </div>
        `,
        });

      if (confirmationError) {
        console.error(
          "Resend institutional plan confirmation email error:",
          confirmationError
        );
        return false;
      }

      console.log(
        "Institutional plan request emails sent successfully via Resend"
      );
      return true;
    } catch (error) {
      console.error(
        "Error sending institutional plan request emails via Resend:",
        error
      );
      return false;
    }
  }

  // Send project share email with attachment
  static async sendProjectShareEmail(
    to: string,
    subject: string,
    html: string,
    attachmentBuffer: Buffer,
    attachmentFilename: string
  ): Promise<boolean> {
    try {
      // For the project share email, we'll keep the html parameter as is since it's passed in
      // Just removing the text-align: center from the outer container if it exists
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }
      const { data, error } = await resend.emails.send({
        from: "ColabWize <noreply@email.colabwize.com>",
        to,
        subject,
        html,
        attachments: [
          {
            filename: attachmentFilename,
            content: attachmentBuffer,
          },
        ],
      });

      if (error) {
        console.error("Resend project share email error:", error);
        return false;
      }

      console.log("Project share email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error("Error sending project share email via Resend:", error);
      return false;
    }
  }
  // Send scan completion email
  static async sendScanCompletionEmail(
    to: string,
    fullName: string,
    scanType: "originality" | "ai-detection" | "citations",
    projectName: string,
    resultSummary: string,
    dashboardUrl: string
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }

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

      const { data, error } = await resend.emails.send({
        from: "ColabWize <scans@email.colabwize.com>",
        to,
        subject,
        html: `
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
        `,
      });

      if (error) {
        console.error("Resend scan completion email error:", error);
        return false;
      }

      console.log("Scan completion email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error("Error sending scan completion email via Resend:", error);
      return false;
    }
  }

  // Send certificate ready email
  static async sendCertificateReadyEmail(
    to: string,
    fullName: string,
    projectName: string,
    certificateUrl: string,
    retentionDays: number
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }

      const retentionMessage =
        retentionDays === -1
          ? "Your certificate will be stored permanently."
          : retentionDays === 0
            ? "Download your certificate now - it will be deleted after download for security."
            : `Your certificate will be available for ${retentionDays} days before automatic deletion.`;

      const { data, error } = await resend.emails.send({
        from: "ColabWize <certificates@email.colabwize.com>",
        to,
        subject: `🎓 Your Authorship Certificate is Ready - ${projectName}`,
        html: `
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
        `,
      });

      if (error) {
        console.error("Resend certificate ready email error:", error);
        return false;
      }

      console.log("Certificate ready email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error("Error sending certificate ready email via Resend:", error);
      return false;
    }
  }

  // Send usage limit warning email
  static async sendUsageLimitWarningEmail(
    to: string,
    fullName: string,
    plan: string,
    scansUsed: number,
    scansLimit: number,
    upgradeUrl: string
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }

      const percentage = Math.round((scansUsed / scansLimit) * 100);
      const remaining = scansLimit - scansUsed;

      const { data, error } = await resend.emails.send({
        from: "ColabWize <alerts@email.colabwize.com>",
        to,
        subject: `⚠️ You've Used ${percentage}% of Your Monthly Scans`,
        html: `
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
                Your usage will reset on the 1st of next month. Upgrade anytime to get more scans immediately!
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team - Your Academic Integrity Partner
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error("Resend usage limit warning email error:", error);
        return false;
      }

      console.log("Usage limit warning email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error(
        "Error sending usage limit warning email via Resend:",
        error
      );
      return false;
    }
  }

  // Send usage limit reached email
  static async sendUsageLimitReachedEmail(
    to: string,
    fullName: string,
    plan: string,
    resetDate: string,
    upgradeUrl: string
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }

      const { data, error } = await resend.emails.send({
        from: "ColabWize <alerts@email.colabwize.com>",
        to,
        subject: `🚫 Monthly Scan Limit Reached - ${plan} Plan`,
        html: `
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
                You've reached your monthly scan limit on the <strong>${plan}</strong> plan. To continue protecting your academic work, please upgrade your plan.
              </p>
              
              <div style="background-color: #fee2e2; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #dc2626;">
                <h2 style="color: #991b1b; margin-top: 0; font-size: 18px;">What This Means</h2>
                <ul style="margin: 10px 0; padding-left: 20px; color: #7f1d1d;">
                  <li>You cannot run new scans until you upgrade or your limit resets</li>
                  <li>Your usage will reset on <strong>${resetDate}</strong></li>
                  <li>Upgrade now to continue scanning immediately</li>
                </ul>
              </div>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                Don't let limits stop your academic progress. Upgrade to continue using ColabWize's powerful features!
              </p>
              
              <div style="margin: 30px 0; text-align: center;">
                <a href="${upgradeUrl}" style="background-color: #1e40af; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; font-size: 16px;">
                  Upgrade Now
                </a>
              </div>
              
              <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
                Need help choosing a plan? Contact our support team - we're here to help!
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team - Your Academic Integrity Partner
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error("Resend usage limit reached email error:", error);
        return false;
      }

      console.log("Usage limit reached email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error(
        "Error sending usage limit reached email via Resend:",
        error
      );
      return false;
    }
  }

  // Send plan change email
  static async sendPlanChangeEmail(
    to: string,
    fullName: string,
    oldPlan: string,
    newPlan: string,
    effectiveDate: string,
    newFeatures: string[]
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }

      const isUpgrade =
        ["free", "student", "researcher"].indexOf(newPlan.toLowerCase()) >
        ["free", "student", "researcher"].indexOf(oldPlan.toLowerCase());

      const subject = isUpgrade
        ? `🎉 Plan Upgraded to ${newPlan}!`
        : `Plan Changed to ${newPlan}`;

      const { data, error } = await resend.emails.send({
        from: "ColabWize <billing@email.colabwize.com>",
        to,
        subject,
        html: `
          <div style="font-family: Arial, sans-serif; background-color: #f4f4f5; ">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px 15px; border-radius: 12px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
              <div style="margin-bottom: 30px;">
                <img src="https://image2url.com/r2/bucket2/images/1767558424944-e48e15a4-5587-40ac-99b0-ee82c5d68042.png" alt="ColabWize Logo"style="width: 100%; height: 120px; max-height: 200px; margin-bottom: 5px;">
                <h1 style="color: #1e40af; font-size: 24px; margin: 10px 0;">${isUpgrade ? "🎉" : "📝"} Plan ${isUpgrade ? "Upgraded" : "Changed"}!</h1>
              </div>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                Hello ${fullName},
              </p>
              
              <p style="color: #666666; font-size: 16px; line-height: 1.6;">
                Your subscription plan has been ${isUpgrade ? "upgraded" : "changed"} from <strong>${oldPlan}</strong> to <strong>${newPlan}</strong>. ${isUpgrade ? "Congratulations on unlocking more powerful features!" : "Your new plan is now active."}
              </p>
              
              <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 30px 0; text-align: left;">
                <h2 style="color: #1e40af; margin-top: 0; font-size: 18px;">${isUpgrade ? "New Features Available" : "Plan Details"}</h2>
                <ul style="margin: 10px 0; padding-left: 20px; color: #333;">
                  ${newFeatures.map((feature) => `<li style="margin: 8px 0;">${feature}</li>`).join("")}
                </ul>
                <p style="margin: 15px 0 5px 0; color: #666;"><strong>Effective Date:</strong> ${effectiveDate}</p>
              </div>
              
              <div style="margin: 30px 0; text-align: center;">
                <a href="http://app.colabwize.com/dashboard" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
                  Explore Your New Features
                </a>
              </div>
              
              <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
                Thank you for choosing ColabWize! Your academic integrity is our priority.
              </p>
              
              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team - Your Academic Integrity Partner
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error("Resend plan change email error:", error);
        return false;
      }

      console.log("Plan change email sent successfully via Resend");
      return true;
    } catch (error) {
      console.error("Error sending plan change email via Resend:", error);
      return false;
    }
  }

  // Send certificate expiration warning email
  static async sendCertificateExpirationWarningEmail(
    to: string,
    fullName: string,
    certificateCount: number,
    expirationDate: string,
    downloadUrl: string
  ): Promise<boolean> {
    try {
      if (!resend) {
        console.error("Resend client not initialized");
        return false;
      }

      const { data, error } = await resend.emails.send({
        from: "ColabWize <certificates@email.colabwize.com>",
        to,
        subject: `⏰ ${certificateCount} Certificate${certificateCount > 1 ? "s" : ""} Expiring Soon`,
        html: `
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
                You have <strong>${certificateCount} authorship certificate${certificateCount > 1 ? "s" : ""}</strong> that will be automatically deleted on <strong>${expirationDate}</strong> based on your plan's retention policy.
              </p>
              
              <div style="background-color: #fef3c7; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #f59e0b;">
                <h2 style="color: #92400e; margin-top: 0; font-size: 18px;">⚠️ Action Required</h2>
                <p style="margin: 5px 0; color: #78350f;">Download your certificates before they're deleted, or upgrade your plan for longer retention.</p>
              </div>
              
              <div style="margin: 30px 0; text-align: center;">
                <a href="${downloadUrl}" style="background-color: #1e40af; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; margin-right: 10px;">
                  Download Certificates
                </a>
                <a href="http://app.colabwize.com/pricing" style="background-color: #fff; color: #1e40af; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block; border: 2px solid #1e40af;">
                  Upgrade Plan
                </a>
              </div>
              
              <p style="color: #666666; font-size: 14px; line-height: 1.6; border-top: 1px solid #eeeeee; padding-top: 20px; margin-top: 20px;">
                <strong>Certificate Retention by Plan:</strong><br>
                • Free: 7 days | Student: 30 days | Researcher: Unlimited
              </p>

              <p style="color: #999999; font-size: 13px; margin-top: 40px; margin-bottom: 5px;">
                ColabWize Team - Your Academic Integrity Partner
              </p>
            </div>
          </div>
        `,
      });

      if (error) {
        console.error(
          "Resend certificate expiration warning email error:",
          error
        );
        return false;
      }

      console.log(
        "Certificate expiration warning email sent successfully via Resend"
      );
      return true;
    } catch (error) {
      console.error(
        "Error sending certificate expiration warning email via Resend:",
        error
      );
      return false;
    }
  }
}
