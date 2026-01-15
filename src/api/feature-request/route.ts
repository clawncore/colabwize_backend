import { Router, type Router as ExpressRouter } from "express";
import { FeatureRequestService } from "../../services/featureRequestService";
import logger from "../../monitoring/logger";
import { authenticateExpressRequest } from "../../middleware/auth";

const router: ExpressRouter = Router();

// Create a new feature request (public endpoint)
router.post("/simple", async (req, res) => {
  try {
    const requestData = req.body;

    // Validate required fields
    if (!requestData.title || !requestData.description) {
      return res.status(400).json({
        success: false,
        message: "Title and description are required",
      });
    }

    // User ID is optional (can be null for anonymous requests)
    const userId = (req as any).user?.id || null;

    const validCategories = [
      "ui",
      "functionality",
      "performance",
      "content",
      "other",
    ];
    if (
      requestData.category &&
      !validCategories.includes(requestData.category)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid category",
      });
    }

    const validPriorities = [
      "low",
      "nice-to-have",
      "medium",
      "high",
      "critical",
    ];
    if (
      requestData.priority &&
      !validPriorities.includes(requestData.priority)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid priority level",
      });
    }

    const request = await FeatureRequestService.createFeatureRequest({
      user_id: userId,
      title: requestData.title,
      description: requestData.description,
      category: requestData.category || "other",
      priority: requestData.priority || "nice-to-have",
    });

    return res.json({
      success: true,
      message: "Feature request created successfully",
      featureRequestId: request.id,
    });
  } catch (error) {
    logger.error("Error creating feature request:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create feature request",
    });
  }
});

// Get all feature requests
router.get("/", authenticateExpressRequest, async (req, res) => {
  try {
    // User ID will be attached by the authentication middleware in main-server.ts
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const { category, status, priority, limit } = req.query;

    const filters: any = {};
    if (category) filters.category = category as string;
    if (status) filters.status = status as string;
    if (priority) filters.priority = priority as string;

    const requests = await FeatureRequestService.getFeatureRequests(
      filters,
      limit ? parseInt(limit as string) : 50
    );

    return res.json({ success: true, requests });
  } catch (error) {
    logger.error("Error fetching feature requests:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch feature requests",
    });
  }
});

// Get a specific feature request by ID
router.get("/:id", authenticateExpressRequest, async (req, res) => {
  try {
    const { id } = req.params;

    // User ID will be attached by the authentication middleware in main-server.ts
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const request = await FeatureRequestService.getFeatureRequestById(id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Feature request not found",
      });
    }

    return res.json({ success: true, request });
  } catch (error) {
    logger.error("Error fetching feature request by ID:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch feature request",
    });
  }
});

// Vote for a feature request
router.post("/:id/vote", authenticateExpressRequest, async (req, res) => {
  try {
    const { id } = req.params;

    // User ID will be attached by the authentication middleware in main-server.ts
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const request = await FeatureRequestService.voteForFeature(id, userId);

    return res.json({
      success: true,
      message: "Vote added successfully",
      votes: request.votes,
    });
  } catch (error: any) {
    if (error.message === "User has already voted for this feature") {
      return res.status(400).json({
        success: false,
        message: "User has already voted for this feature",
      });
    }

    logger.error("Error voting for feature:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to vote for feature",
    });
  }
});

// Update feature request status (admin only)
router.patch("/:id/status", authenticateExpressRequest, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required",
      });
    }

    const validStatuses = [
      "open",
      "planned",
      "in_progress",
      "implemented",
      "closed",
    ];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: "Invalid status",
      });
    }

    // User ID will be attached by the authentication middleware in main-server.ts
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "User not authenticated",
      });
    }

    const request = await FeatureRequestService.updateFeatureStatus(
      userId,
      id,
      status
    );

    return res.json({ success: true, request });
  } catch (error: any) {
    if (error.message === "Only administrators can update feature status") {
      return res.status(403).json({
        success: false,
        message: "Access denied. Admin privileges required.",
      });
    }

    logger.error("Error updating feature status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update feature status",
    });
  }
});

export default router;
