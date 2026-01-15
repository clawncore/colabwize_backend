import express from "express";
import { SurveyService } from "../../services/surveyService";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";

const router = express.Router();

/**
 * POST /api/survey/submit
 * Submit survey responses (requires authentication)
 */
router.post("/submit", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;
    const { 
      role, 
      institution, 
      fieldOfStudy, 
      primaryUseCase,
      heardAboutPlatform,
      userGoal,
      mainJob
    } = req.body;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    if (!role) {
      return res.status(400).json({
        success: false,
        message: "Role is required",
      });
    }

    const result = await SurveyService.submitSurvey(user.id, {
      role,
      institution,
      fieldOfStudy,
      primaryUseCase,
      heardAboutPlatform,
      userGoal,
      mainJob,
    });

    if (result.success) {
      return res.status(200).json(result);
    } else {
      return res.status(400).json(result);
    }
  } catch (error) {
    console.error("Submit survey error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to submit survey. Please try again.",
    });
  }
});

/**
 * GET /api/survey/status
 * Get survey status (requires authentication)
 */
router.get("/status", authenticateHybridRequest, async (req, res) => {
  try {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated",
      });
    }

    const status = await SurveyService.getSurveyStatus(user.id);

    return res.status(200).json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error("Get survey status error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get survey status.",
    });
  }
});

export default router;
