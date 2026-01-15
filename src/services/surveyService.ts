import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

/**
 * Survey Service for User Onboarding
 */
export class SurveyService {
  /**
   * Submit survey responses
   */
  static async submitSurvey(
    userId: string,
    surveyData: {
      role: string;
      institution?: string;
      fieldOfStudy?: string;
      primaryUseCase?: string;
      heardAboutPlatform?: string;
      userGoal?: string;
      mainJob?: string;
    }
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      // Check if survey already exists
      const existingSurvey = await prisma.userSurvey.findUnique({
        where: { user_id: userId },
      });

      if (existingSurvey) {
        // If already completed, return success so user can proceed to dashboard
        return {
          success: true,
          message: "Survey already completed",
        };
      }

      // Create survey
      await prisma.userSurvey.create({
        data: {
          user_id: userId,
          role: surveyData.role,
          institution: surveyData.institution,
          field_of_study: surveyData.fieldOfStudy,
          primary_use_case: surveyData.primaryUseCase,
          heard_about_platform: surveyData.heardAboutPlatform,
          user_goal: surveyData.userGoal,
          main_job: surveyData.mainJob,
        },
      });

      // Mark user survey as completed
      await prisma.user.update({
        where: { id: userId },
        data: { survey_completed: true },
      });

      logger.info("Survey submitted successfully", { userId });

      // Send Discord notification asynchronously (don't block response)
      this.sendDiscordNotification(userId, surveyData).catch((err) =>
        logger.error("Failed to send survey Discord notification", { err })
      );

      return {
        success: true,
        message: "Survey submitted successfully",
      };
    } catch (error) {
      logger.error("Survey submission failed", { error, userId });
      return {
        success: false,
        message: "Failed to submit survey. Please try again.",
      };
    }
  }

  /**
   * Send Discord notification for new survey
   */
  private static async sendDiscordNotification(
    userId: string,
    surveyData: any
  ): Promise<void> {
    const { SecretsService } = await import("./secrets-service");
    const webhookUrl = await SecretsService.getSignupSurveyWebhookUrl();

    if (!webhookUrl) return;

    // Get user details for context
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, plan: true }, // Assuming 'plan' exists on user
    });

    const embed = {
      title: "New User Survey Submission",
      color: 0x00ff00, // Green
      fields: [
        { name: "User ID", value: userId, inline: true },
        { name: "Email", value: user?.email || "Unknown", inline: true },
        { name: "Plan", value: user?.plan || "Free", inline: true },
        { name: "Role", value: surveyData.role || "N/A", inline: true },
        {
          name: "Heard About",
          value: surveyData.heardAboutPlatform || "N/A",
          inline: true,
        },
        { name: "Goal", value: surveyData.userGoal || "N/A", inline: false },
        { name: "Main Job", value: surveyData.mainJob || "N/A", inline: false },
      ],
      timestamp: new Date().toISOString(),
    };

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
  }

  /**
   * Get survey status
   */
  static async getSurveyStatus(userId: string): Promise<{
    completed: boolean;
    survey?: any;
  }> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          survey: true,
        },
      });

      if (!user) {
        return { completed: false };
      }

      return {
        completed: user.survey_completed,
        survey: user.survey || undefined,
      };
    } catch (error) {
      logger.error("Failed to get survey status", { error, userId });
      return { completed: false };
    }
  }
}
