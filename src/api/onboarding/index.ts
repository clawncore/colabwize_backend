import express from "express";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { authenticateExpressRequest } from "../../middleware/auth";

interface AuthenticatedRequest extends express.Request {
  user?: {
    id: string;
    email: string;
    full_name?: string;
  };
}

const router = express.Router();

/**
 * GET /api/onboarding/status
 * Get user's onboarding status
 */
router.get(
  "/status",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          onboarding_completed: true,
          onboarding_skipped: true,
          first_upload_at: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          completed: user.onboarding_completed,
          skipped: user.onboarding_skipped,
          hasUploaded: !!user.first_upload_at,
          shouldShowTour:
            !user.onboarding_completed && !user.onboarding_skipped,
        },
      });
    } catch (error: any) {
      logger.error("Error getting onboarding status", { error: error.message });
      return res.status(500).json({
        success: false,
        message: "Failed to get onboarding status",
      });
    }
  }
);

/**
 * POST /api/onboarding/complete
 * Mark onboarding as completed
 */
router.post(
  "/complete",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          onboarding_completed: true,
        },
      });

      logger.info("Onboarding completed", { userId });

      return res.status(200).json({
        success: true,
        message: "Onboarding completed successfully",
      });
    } catch (error: any) {
      logger.error("Error completing onboarding", { error: error.message });
      return res.status(500).json({
        success: false,
        message: "Failed to complete onboarding",
      });
    }
  }
);

/**
 * POST /api/onboarding/skip
 * Mark onboarding as skipped
 */
router.post(
  "/skip",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      await prisma.user.update({
        where: { id: userId },
        data: {
          onboarding_skipped: true,
        },
      });

      logger.info("Onboarding skipped", { userId });

      return res.status(200).json({
        success: true,
        message: "Onboarding skipped",
      });
    } catch (error: any) {
      logger.error("Error skipping onboarding", { error: error.message });
      return res.status(500).json({
        success: false,
        message: "Failed to skip onboarding",
      });
    }
  }
);

/**
 * GET /api/onboarding/survey
 * Get user's survey status
 */
router.get(
  "/survey",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // Check if user has completed the survey
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          survey_completed: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Try to get the survey data
      let survey = null;
      try {
        survey = await prisma.userSurvey.findUnique({
          where: { user_id: userId },
        });
      } catch (err) {
        // Survey doesn't exist, which is fine
      }

      return res.status(200).json({
        success: true,
        data: {
          surveyCompleted: user.survey_completed,
          hasSurvey: !!survey,
          surveyData: survey,
          shouldShowSurvey: !user.survey_completed,
        },
      });
    } catch (error: any) {
      logger.error("Error getting survey status", { error: error.message });
      return res.status(500).json({
        success: false,
        message: "Failed to get survey status",
      });
    }
  }
);

/**
 * POST /api/onboarding/survey
 * Submit user survey
 */
router.post(
  "/survey",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const {
        role,
        institution,
        fieldOfStudy,
        primaryUseCase,
        heardAboutPlatform,
        userGoal,
        mainJob,
      } = (req as any).body;

      // Validate required fields
      if (!role) {
        return res.status(400).json({
          success: false,
          message: "Role is required",
        });
      }

      // Check if user already has a survey
      let existingSurvey = null;
      try {
        existingSurvey = await prisma.userSurvey.findUnique({
          where: { user_id: userId },
        });
      } catch (err) {
        // Survey doesn't exist yet, which is fine
      }

      if (existingSurvey) {
        // Update existing survey
        await prisma.userSurvey.update({
          where: { user_id: userId },
          data: {
            role,
            institution,
            field_of_study: fieldOfStudy,
            primary_use_case: primaryUseCase,
            heard_about_platform: heardAboutPlatform,
            user_goal: userGoal,
            main_job: mainJob,
          },
        });
      } else {
        // Create new survey
        await prisma.userSurvey.create({
          data: {
            user_id: userId,
            role,
            institution,
            field_of_study: fieldOfStudy,
            primary_use_case: primaryUseCase,
            heard_about_platform: heardAboutPlatform,
            user_goal: userGoal,
            main_job: mainJob,
          },
        });
      }

      // Mark user as having completed survey
      await prisma.user.update({
        where: { id: userId },
        data: { survey_completed: true },
      });

      logger.info("Survey submitted", { userId, role, institution });

      return res.status(200).json({
        success: true,
        message: "Survey submitted successfully",
      });
    } catch (error: any) {
      logger.error("Error submitting survey", { error: error.message });
      return res.status(500).json({
        success: false,
        message: "Failed to submit survey",
      });
    }
  }
);

/**
 * GET /api/onboarding/progress
 * Get complete onboarding progress
 */
router.get(
  "/progress",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          onboarding_completed: true,
          onboarding_skipped: true,
          survey_completed: true,
          first_upload_at: true,
          email_verified: true,
          full_name: true,
        },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Calculate progress
      const steps = [
        {
          id: "profile",
          completed: !!user.full_name,
          title: "Complete Profile",
        },
        { id: "email", completed: user.email_verified, title: "Verify Email" },
        {
          id: "survey",
          completed: user.survey_completed,
          title: "Complete Survey",
        },
        {
          id: "upload",
          completed: !!user.first_upload_at,
          title: "Upload First File",
        },
        {
          id: "onboarding",
          completed: user.onboarding_completed,
          title: "Complete Onboarding",
        },
      ];

      const completedSteps = steps.filter((step) => step.completed).length;
      const totalSteps = steps.length;
      const progressPercentage = Math.round(
        (completedSteps / totalSteps) * 100
      );

      return res.status(200).json({
        success: true,
        data: {
          completed: user.onboarding_completed,
          skipped: user.onboarding_skipped,
          progress: progressPercentage,
          completedSteps,
          totalSteps,
          steps,
          isComplete:
            user.onboarding_completed ||
            (completedSteps === totalSteps && !user.onboarding_skipped),
        },
      });
    } catch (error: any) {
      logger.error("Error getting onboarding progress", {
        error: error.message,
      });
      return res.status(500).json({
        success: false,
        message: "Failed to get onboarding progress",
      });
    }
  }
);

/**
 * POST /api/onboarding/profile
 * Update user profile as part of onboarding
 */
router.post(
  "/profile",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res) => {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const { fullName, institution, fieldOfStudy } = (req as any).body;

      // Update user profile
      await prisma.user.update({
        where: { id: userId },
        data: {
          full_name: fullName,
          institution,
          field_of_study: fieldOfStudy,
        },
      });

      logger.info("Profile updated", { userId, fullName, institution });

      return res.status(200).json({
        success: true,
        message: "Profile updated successfully",
      });
    } catch (error: any) {
      logger.error("Error updating profile", { error: error.message });
      return res.status(500).json({
        success: false,
        message: "Failed to update profile",
      });
    }
  }
);

export default router;
