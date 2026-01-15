import { EmailService } from "./emailService";
import { prisma } from "../lib/prisma";
import fetch from "node-fetch";
import { SecretsService } from "./secrets-service";

export class ContactService {
  // Handle contact form submission
  static async handleContactSubmission(data: {
    name: string;
    email: string;
    subject: string;
    message: string;
    ip_address?: string;
    user_agent?: string;
  }) {
    try {
      // Validate input data
      if (!data.name || !data.email || !data.subject || !data.message) {
        throw new Error("All fields are required");
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        throw new Error("Invalid email format");
      }

      // Store the contact request in the database
      const contactRequest = await prisma.contactRequest.create({
        data: {
          name: data.name,
          email: data.email,
          subject: data.subject,
          message: data.message,
          ip_address: data.ip_address,
          user_agent: data.user_agent,
          status: "new",
        },
      });

      // Send notification email to admin team (if email service is configured)
      const adminEmail = await SecretsService.getContactAdminEmail();
      try {
        await this.sendAdminNotification(adminEmail, data);
      } catch (emailError) {
        console.warn(
          "Warning: Failed to send admin notification via Discord webhook:",
          emailError
        );
        // Continue with the process even if email fails
      }

      // Send confirmation email to the user (if email service is configured)
      try {
        await this.sendUserConfirmation(data);
      } catch (emailError) {
        console.warn(
          "Warning: Failed to send user confirmation email:",
          emailError
        );
        // Continue with the process even if email fails
      }

      return {
        success: true,
        message:
          "Your message has been sent successfully. We'll get back to you soon.",
        contactRequestId: contactRequest.id,
      };
    } catch (error) {
      console.error("Error handling contact submission:", error);
      throw error;
    }
  }

  // Send notification to admin team via Discord webhook
  private static async sendAdminNotification(
    adminEmail: string, // This parameter is kept for backward compatibility but not used
    data: {
      name: string;
      email: string;
      subject: string;
      message: string;
      ip_address?: string;
      user_agent?: string;
    }
  ): Promise<boolean> {
    try {
      // Determine type of request
      const lowerSubject = data.subject.toLowerCase();
      const isFeatureRequest =
        lowerSubject.includes("feature") || lowerSubject === "feature request";
      const isDemoRequest =
        lowerSubject.includes("demo") || lowerSubject === "schedule demo";

      // Select appropriate webhook URL from environment variables
      let webhookUrl = await SecretsService.getContactWebhookUrl();
      if (isFeatureRequest) {
        webhookUrl = await SecretsService.getFeatureWebhookUrl();
      } else if (isDemoRequest) {
        webhookUrl = await SecretsService.getDemoWebhookUrl();
      }

      if (!webhookUrl) {
        console.warn(
          "Warning: Discord webhook URL not configured in environment variables for this request type"
        );
        return false;
      }

      // Configure embed appearance
      let title = "📬 New Contact Form Submission";
      let description = "A new contact form submission has been received!";
      let color = 3447003; // Blue for contact
      let footerText = "ColabWize Contact Form";

      if (isFeatureRequest) {
        title = "🚀 New Feature Request";
        description = "A new feature request has been submitted!";
        color = 10181046; // Purple for feature
        footerText = "ColabWize Feature Request";
      } else if (isDemoRequest) {
        title = "📅 New Demo Request";
        description = "A new demo request has been submitted!";
        color = 2067276; // Green for demo
        footerText = "ColabWize Demo Request";
      }

      // Create embed for Discord message
      const embed = {
        title: title,
        description: description,
        color: color,
        fields: [
          {
            name: "👤 Name",
            value: data.name,
            inline: true,
          },
          {
            name: "📧 Email",
            value: data.email,
            inline: true,
          },
          {
            name: "📌 Subject",
            value: data.subject,
            inline: false,
          },
          {
            name: "💬 Message",
            value:
              data.message.length > 1024
                ? data.message.substring(0, 1021) + "..."
                : data.message,
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: footerText,
        },
      };

      // Add IP address and user agent if available
      if (data.ip_address || data.user_agent) {
        const metadataFields = [];
        if (data.ip_address) {
          metadataFields.push({
            name: "🌐 IP Address",
            value: data.ip_address,
            inline: true,
          });
        }
        if (data.user_agent) {
          metadataFields.push({
            name: "🖥️ User Agent",
            value:
              data.user_agent.length > 1024
                ? data.user_agent.substring(0, 1021) + "..."
                : data.user_agent,
            inline: false,
          });
        }
        embed.fields = [...embed.fields, ...metadataFields];
      }

      // Send POST request to Discord webhook
      const contentPrefix = isFeatureRequest
        ? "<@&admin> New feature request received!"
        : isDemoRequest
          ? "<@&admin> New demo request received!"
          : "<@&admin> New contact form submission received!";

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: contentPrefix,
          embeds: [embed],
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Discord webhook request failed with status ${response.status}`
        );
      }

      console.log("Admin notification sent successfully via Discord webhook");
      return true;
    } catch (error) {
      console.error(
        "Error sending admin notification via Discord webhook:",
        error
      );
      return false;
    }
  }

  // Send confirmation email to the user
  private static async sendUserConfirmation(data: {
    name: string;
    email: string;
    subject: string;
    message: string;
  }): Promise<boolean> {
    try {
      const subjectLine = "We've Received Your Message - ColabWize";

      const htmlBody = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #3B82F6;">Thanks for Reaching Out!</h2>
          
          <p>Hello ${data.name},</p>
          
          <p>We've received your message and appreciate you taking the time to contact us. Our team will review your inquiry and get back to you within 24 hours.</p>
          
          <div style="background-color: #f1f5f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #1e293b;">Your Message Summary</h3>
            <p><strong>Subject:</strong> ${data.subject}</p>
            <p><strong>Message:</strong></p>
            <p style="white-space: pre-wrap; line-height: 1.5;">${data.message}</p>
          </div>

          <p>In the meantime, you might find answers to common questions in our <a href="https://app.colabwize.com/resources/help-center" style="color: #3B82F6;">Help Center</a>.</p>
          
          <p>Best regards,<br/>
          The ColabWize Team</p>
          
          <hr style="margin: 30px 0; border: none; border-top: 1px solid #e2e8f0;">
          
          <p style="font-size: 12px; color: #64748b;">
            This is an automated confirmation. Please do not reply to this email. If you need immediate assistance, contact us at hello@colabwize.com.
          </p>
        </div>
      `;

      return EmailService.sendNotificationEmail(
        data.email,
        data.name,
        subjectLine,
        htmlBody,
        "contact"
      );
    } catch (error) {
      console.error("Error sending user confirmation:", error);
      return false;
    }
  }

  // Get contact requests (for admin panel)
  static async getContactRequests(status?: string, limit: number = 50) {
    try {
      const whereClause = status ? { status } : {};

      const contactRequests = await prisma.contactRequest.findMany({
        where: whereClause,
        orderBy: {
          created_at: "desc",
        },
        take: limit,
      });

      return contactRequests;
    } catch (error) {
      console.error("Error fetching contact requests:", error);
      throw new Error("Failed to fetch contact requests");
    }
  }

  // Update contact request status
  static async updateContactRequestStatus(
    id: string,
    status: "new" | "replied" | "resolved" | "spam"
  ) {
    try {
      const updatedRequest = await prisma.contactRequest.update({
        where: {
          id: id,
        },
        data: {
          status: status,
          replied_at:
            status === "replied" || status === "resolved"
              ? new Date()
              : undefined,
          updated_at: new Date(),
        },
      });

      return updatedRequest;
    } catch (error) {
      console.error("Error updating contact request status:", error);
      throw new Error("Failed to update contact request status");
    }
  }

  // Get contact request by ID
  static async getContactRequestById(id: string) {
    try {
      const contactRequest = await prisma.contactRequest.findUnique({
        where: {
          id: id,
        },
      });

      return contactRequest;
    } catch (error) {
      console.error("Error fetching contact request:", error);
      throw new Error("Failed to fetch contact request");
    }
  }
}
