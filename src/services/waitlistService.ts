import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";
import SecretsService from "./secrets-service";

export class WaitlistService {
  /**
   * Add a user to the waitlist
   * Uses UserFeedback table with type='waitlist_entry' to avoid schema changes
   */
  static async addToWaitlist(data: {
    email: string;
    feature: string;
    name?: string;
    reason?: string;
    additionalData?: any;
  }) {
    try {
      // Check if already on waitlist for this feature
      const existing = await prisma.userFeedback.findFirst({
        where: {
          type: "waitlist_entry",
          category: data.feature, // Storing feature name in category
          description: {
            contains: data.email, // Checking if email is in description
          },
        },
      });

      if (existing) {
        return {
          success: true,
          message: "You are already on the waitlist for this feature.",
          entry: existing,
        };
      }

      // Create new entry
      const entry = await prisma.userFeedback.create({
        data: {
          type: "waitlist_entry",
          category: data.feature,
          priority: "medium",
          title: `Waitlist: ${data.email}`,
          description: JSON.stringify({
            email: data.email,
            name: data.name,
            reason: data.reason,
            feature: data.feature,
            ...data.additionalData,
          }),
          status: "pending",
        },
      });

      // Notify via Discord
      await this.notifyTeam(data);

      return {
        success: true,
        message: "Successfully added to waitlist",
        entry,
      };
    } catch (error) {
      logger.error("Error adding to waitlist:", error);
      throw new Error("Failed to add to waitlist");
    }
  }

  /**
   * Check if user is on waitlist
   */
  static async isOnWaitlist(email: string, feature?: string) {
    try {
      const where: any = {
        type: "waitlist_entry",
        description: {
          contains: `"${email}"`, // Since we store JSON
        },
      };

      if (feature) {
        where.category = feature;
      }

      const entry = await prisma.userFeedback.findFirst({
        where,
      });

      return !!entry;
    } catch (error) {
      logger.error("Error checking waitlist status:", error);
      return false;
    }
  }

  /**
   * Get position (mocked implementation as typical for waitlists without strict ordering)
   */
  static async getPosition(email: string) {
    try {
      // Just count how many are before this user
      const entry = await prisma.userFeedback.findFirst({
        where: {
          type: "waitlist_entry",
          description: { contains: `"${email}"` },
        },
      });

      if (!entry) return null;

      const count = await prisma.userFeedback.count({
        where: {
          type: "waitlist_entry",
          created_at: {
            lt: entry.created_at,
          },
        },
      });

      return count + 1;
    } catch (error) {
      return null;
    }
  }

  private static async notifyTeam(data: any) {
    try {
      const webhookUrl =
        "https://discord.com/api/webhooks/1445349012785074317/tVR9cz3trTXBLU3aThYV1gMcZJ8v0gLX65192h0x0986EaqzZzDpVs4R2AvT9Tt3mtUm"; // Reusing feature team webhook

      const embed = {
        title: "🎉 New Waitlist Signup",
        description: `User joined waitlist for **${data.feature}**`,
        color: 10181046, // Purple
        fields: [
          { name: "Email", value: data.email, inline: true },
          { name: "Feature", value: data.feature, inline: true },
        ],
        timestamp: new Date().toISOString(),
      };

      if (data.reason) {
        embed.fields.push({
          name: "Reason",
          value: data.reason,
          inline: false,
        });
      }

      // Add additional data fields if present
      if (data.additionalData) {
        if (data.additionalData.institution) {
          embed.fields.push({
            name: "Institution",
            value: data.additionalData.institution,
            inline: true,
          });
        }
        if (data.additionalData.researchArea) {
          embed.fields.push({
            name: "Research Area",
            value: data.additionalData.researchArea,
            inline: true,
          });
        }
        if (data.additionalData.experience) {
          embed.fields.push({
            name: "Experience",
            value: data.additionalData.experience,
            inline: true,
          });
        }

        // Add any other fields generically
        Object.keys(data.additionalData).forEach((key) => {
          if (!["institution", "researchArea", "experience"].includes(key)) {
            embed.fields.push({
              name: key,
              value: String(data.additionalData[key]),
              inline: true,
            });
          }
        });
      }

      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ embeds: [embed] }),
      });
    } catch (error) {
      logger.error("Failed to notifiy team about waitlist", error);
    }
  }
}
