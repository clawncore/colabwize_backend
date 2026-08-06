import { sendEmail } from "./email/baseMailer";
import { buildEmailHtml } from "./email/emailLayout";
import { prisma } from "../lib/prisma";

import { SecretsService } from "./secrets-service";

export class ContactService {
  // Generate ticket number: CW-YYYY-XXXX (e.g. CW-2026-0001)
  private static async generateTicketNumber(): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `CW-${year}-`;

    // Count tickets created this year to get next sequence number
    const count = await prisma.contactRequest.count({
      where: {
        ticket_number: { startsWith: prefix },
      },
    });

    const seq = (count + 1).toString().padStart(4, "0");
    return `${prefix}${seq}`;
  }

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

      // Generate ticket number
      const ticketNumber = await this.generateTicketNumber();

      // Store the contact request in the database
      const contactRequest = await prisma.contactRequest.create({
        data: {
          ticket_number: ticketNumber,
          name: data.name,
          email: data.email,
          subject: data.subject,
          message: data.message,
          ip_address: data.ip_address,
          user_agent: data.user_agent,
          status: "new",
        },
      });

      // Also insert into support_messages so it appears in the admin inbox
      const threadId = `contact-${ticketNumber}`;
      const imapUid = Math.floor(Date.now() / 1000);
      await prisma.supportMessage.create({
        data: {
          sender_email: data.email,
          subject: `[${ticketNumber}] ${data.subject}`,
          message_text: `Name: ${data.name}\nTicket: ${ticketNumber}\n\n${data.message}`,
          message_html: `<p><strong>Name:</strong> ${data.name}</p><p><strong>Ticket:</strong> ${ticketNumber}</p><hr><p>${data.message.replace(/\n/g, "<br>")}</p>`,
          thread_id: threadId,
          source_alias: "contact-form",
          imap_uid: imapUid,
          status: "open",
          folder: "Support",
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

      // Send email to admin so they receive the message in their inbox
      try {
        await this.sendAdminEmail({ ...data, ticketNumber });
      } catch (emailError) {
        console.warn(
          "Warning: Failed to send admin email notification:",
          emailError
        );
      }

      // Send confirmation email to the user (if email service is configured)
      try {
        await this.sendUserConfirmation({ ...data, ticketNumber });
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
        ticketNumber,
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
    ticketNumber: string;
  }): Promise<boolean> {
    try {
      const subjectLine = `Support Request Received — ${data.ticketNumber}`;

      const content = `
        <p>Hello ${data.name},</p>
        <p>Your request has been received. Our team will review it and respond within 24 hours.</p>
        
        <div style="background-color: #f1f5f9; padding: 24px; border-radius: 12px; margin: 24px 0; border: 1px solid #e2e8f0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 14px;">Ticket Number</td>
              <td style="padding: 6px 0; color: #0ea5e9; font-weight: 700; font-size: 16px; text-align: right;">${data.ticketNumber}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 14px;">Subject</td>
              <td style="padding: 6px 0; text-align: right;">${data.subject}</td>
            </tr>
          </table>
          <hr style="margin: 16px 0; border: none; border-top: 1px solid #e2e8f0;">
          <p style="margin: 0; white-space: pre-wrap; line-height: 1.6; color: #334155;">${data.message}</p>
        </div>

        <p style="color: #64748b; font-size: 14px;">Save your ticket number — you'll need it to check status or reopen this request.</p>
      `;

      const html = buildEmailHtml({
        title: "Support Request Received",
        content,
        titleColor: "#0ea5e9",
      });

      const { success } = await sendEmail({
        from: "NOTIFICATIONS",
        to: data.email,
        subject: subjectLine,
        html,
        text: `Hello ${data.name},\n\nYour support request has been received.\n\nTicket: ${data.ticketNumber}\nSubject: ${data.subject}\n\nOur team will review it and respond within 24 hours.\n\nColabWize Support`,
      });

      return success;
    } catch (error) {
      console.error("Error sending user confirmation:", error);
      return false;
    }
  }

  // Send admin email so the team receives the contact form in their inbox
  private static async sendAdminEmail(data: {
    name: string;
    email: string;
    subject: string;
    message: string;
    ticketNumber: string;
  }): Promise<boolean> {
    try {
      const adminEmail = await SecretsService.getContactAdminEmail();
      if (!adminEmail) {
        console.warn("No admin email configured for contact notifications");
        return false;
      }

      const subjectLine = `[${data.ticketNumber}] ${data.subject}`;

      const content = `
        <div style="background-color: #f1f5f9; padding: 24px; border-radius: 12px; margin: 24px 0; border: 1px solid #e2e8f0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 14px;">Ticket</td>
              <td style="padding: 6px 0; color: #0ea5e9; font-weight: 700; font-size: 16px; text-align: right;">${data.ticketNumber}</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 14px;">From</td>
              <td style="padding: 6px 0; text-align: right;">${data.name} &lt;${data.email}&gt;</td>
            </tr>
            <tr>
              <td style="padding: 6px 0; color: #64748b; font-size: 14px;">Subject</td>
              <td style="padding: 6px 0; text-align: right;">${data.subject}</td>
            </tr>
          </table>
          <hr style="margin: 16px 0; border: none; border-top: 1px solid #e2e8f0;">
          <p style="margin: 0 0 8px 0; font-weight: 600; color: #1e293b;">Message</p>
          <p style="white-space: pre-wrap; line-height: 1.6; margin: 0; color: #334155;">${data.message}</p>
        </div>

        <p style="color: #64748b; font-size: 14px;">
          Reply directly to <strong>${data.email}</strong> to respond to this inquiry.
        </p>
      `;

      const html = buildEmailHtml({
        title: "New Contact Form Submission",
        content,
        titleColor: "#111827",
      });

      const { success } = await sendEmail({
        from: "SUPPORT",
        to: adminEmail,
        subject: subjectLine,
        html,
        text: `New Contact Form Submission\n\nTicket: ${data.ticketNumber}\nFrom: ${data.name} <${data.email}>\nSubject: ${data.subject}\n\nMessage:\n${data.message}\n\nReply to: ${data.email}`,
      });

      return success;
    } catch (error) {
      console.error("Error sending admin email notification:", error);
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
