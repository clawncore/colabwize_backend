import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import { EmailService } from "./emailService";
import SecretsService from "./secrets-service";

interface SupportTicket {
  id: string;
  user_id: string | null;
  subject: string;
  message: string;
  priority: string;
  status: string;
  attachment_url: string | null;
  browser_info: string | null;
  os_info: string | null;
  screen_size: string | null;
  user_plan: string | null;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

export class SupportTicketService {
  // Create a new support ticket
  static async createSupportTicket(
    ticketData: Omit<
      SupportTicket,
      "id" | "created_at" | "updated_at" | "resolved_at" | "status"
    >
  ): Promise<SupportTicket> {
    try {
      const ticket = await prisma.supportTicket.create({
        data: {
          user_id: ticketData.user_id || undefined,
          subject: ticketData.subject,
          message: ticketData.message,
          priority: ticketData.priority,
          status: "open",
          attachment_url: ticketData.attachment_url || undefined,
          browser_info: ticketData.browser_info || undefined,
          os_info: ticketData.os_info || undefined,
          screen_size: ticketData.screen_size || undefined,
          user_plan: ticketData.user_plan || undefined,
        },
      });

      // Log the action
      await this.logTicketAction(
        ticket.user_id,
        "ticket_created",
        ticket.id,
        "SupportTicket",
        {
          subject: ticket.subject,
          priority: ticket.priority,
        }
      );

      // Notify support team
      await this.notifySupportTeam(
        `New Support Ticket: ${ticket.subject}`,
        `A new support ticket has been submitted: "${ticket.subject}" with priority ${ticket.priority}`
      );

      return ticket;
    } catch (error) {
      logger.error("Error creating support ticket:", error);
      throw new Error("Failed to create support ticket");
    }
  }

  // Get tickets for a user
  static async getUserTickets(userId: string): Promise<SupportTicket[]> {
    try {
      return await prisma.supportTicket.findMany({
        where: {
          user_id: userId,
        },
        orderBy: {
          created_at: "desc",
        },
      });
    } catch (error) {
      logger.error("Error fetching user tickets:", error);
      throw new Error("Failed to fetch user tickets");
    }
  }

  // Get a specific ticket
  static async getTicketById(
    userId: string,
    ticketId: string
  ): Promise<SupportTicket | null> {
    try {
      const ticket = await prisma.supportTicket.findUnique({
        where: {
          id: ticketId,
        },
      });

      if (!ticket) {
        return null;
      }

      // Check if user is authorized to view this ticket
      const isAdmin = await this.isUserAdmin(userId);
      if (!isAdmin && ticket.user_id !== userId) {
        throw new Error("Unauthorized access to ticket");
      }

      return ticket;
    } catch (error) {
      logger.error("Error fetching ticket by ID:", error);
      throw new Error("Failed to fetch ticket");
    }
  }

  // Update ticket status
  static async updateTicketStatus(
    userId: string,
    ticketId: string,
    status: string,
    adminNotes?: string
  ): Promise<SupportTicket> {
    try {
      // Check if user is admin
      const isAdmin = await this.isUserAdmin(userId);
      if (!isAdmin) {
        throw new Error("Only administrators can update ticket status");
      }

      const ticket = await prisma.supportTicket.update({
        where: {
          id: ticketId,
        },
        data: {
          status,
          resolved_at: status === "resolved" ? new Date() : undefined,
        },
      });

      // Log the action
      await this.logTicketAction(
        userId,
        `ticket_${status}`,
        ticketId,
        "SupportTicket",
        {
          status,
          adminNotes,
        }
      );

      // Notify the user if they provided an email
      if (ticket.user_id) {
        const user = await prisma.user.findUnique({
          where: {
            id: ticket.user_id,
          },
        });

        if (user) {
          let subject, message;
          if (status === "resolved") {
            subject = "Your Support Ticket Has Been Resolved";
            message = `Your support ticket "${ticket.subject}" has been resolved.`;
          } else if (status === "in_progress") {
            subject = "We're Working on Your Support Ticket";
            message = `We're currently working on your support ticket "${ticket.subject}". We'll update you when it's resolved.`;
          } else if (status === "closed") {
            subject = "Your Support Ticket Has Been Closed";
            message = `Your support ticket "${ticket.subject}" has been closed. If you have any further questions, please let us know.`;
          }

          if (subject && message) {
            await EmailService.sendNotificationEmail(
              user.email,
              user.full_name || "User",
              subject,
              message,
              "support"
            );
          }
        }
      }

      return ticket;
    } catch (error) {
      logger.error("Error updating ticket status:", error);
      throw new Error("Failed to update ticket status");
    }
  }

  // Check if user is admin
  static async isUserAdmin(userId: string): Promise<boolean> {
    try {
      // Check if user has admin role
      const user = await prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          user_role: true,
          email: true,
        },
      });

      // Check if user has admin role
      if (user && user.user_role === "admin") {
        return true;
      }

      // Check if user is in the support team
      if (
        user &&
        (user.user_role === "support" || user.email.endsWith("@colabwize.com"))
      ) {
        return true;
      }

      // Check specific admin user IDs from environment variables
      const adminUserIds = await SecretsService.getAdminUserIds();
      if (adminUserIds.includes(userId)) {
        return true;
      }

      return false;
    } catch (error) {
      logger.error("Error checking admin status:", error);
      return false;
    }
  }

  // Log ticket action for audit purposes
  static async logTicketAction(
    userId: string | null,
    action: string,
    resourceId: string | null,
    resourceType: string | null,
    details?: any
  ): Promise<void> {
    try {
      // Create a dedicated ticket audit log entry
      await prisma.auditLog.create({
        data: {
          user_id: userId || undefined,
          action,
          resource_id: resourceId || undefined,
          resource_type: resourceType || undefined,
          details: details ? JSON.stringify(details) : undefined,
          ip_address: details?.ipAddress || undefined,
          user_agent: details?.userAgent || undefined,
        },
      });
    } catch (error) {
      logger.error("Error logging ticket action:", error);
      // Don't throw error as this is just for logging
    }
  }

  // Notify support team via Discord webhook
  static async notifySupportTeam(
    subject: string,
    message: string
  ): Promise<void> {
    try {
      // Discord webhook URL for support team notifications
      const webhookUrl =
        "https://discord.com/api/webhooks/1445349012785074317/tVR9cz3trTXBLU3aThYV1gMcZJ8v0gLX65192h0x0986EaqzZzDpVs4R2AvT9Tt3mtUm";

      // Create embed for Discord message
      const embed = {
        title: "🎫 Support Team Notification",
        description: subject,
        color: 15105570, // Orange color
        fields: [
          {
            name: "📝 Message",
            value:
              message.length > 1024
                ? message.substring(0, 1021) + "..."
                : message,
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: "ColabWize Support System",
        },
      };

      // Send POST request to Discord webhook
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: "<@&support-team> New support ticket!",
          embeds: [embed],
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Discord webhook request failed with status ${response.status}`
        );
      }

      logger.info("Support team notified via Discord webhook", {
        subject,
        message,
      });
    } catch (error) {
      logger.error("Error notifying support team via Discord webhook:", error);
      // Fallback to email notification if Discord fails
      try {
        const supportEmail = await SecretsService.getContactAdminEmail();
        await EmailService.sendNotificationEmail(
          supportEmail,
          "Support Team",
          subject,
          message,
          "support"
        );
      } catch (emailError) {
        logger.error("Error sending fallback email notification:", emailError);
      }
    }
  }
}
