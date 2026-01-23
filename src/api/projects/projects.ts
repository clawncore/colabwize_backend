import { Router, Request, Response } from "express";
import { authenticateExpressRequest } from "../../middleware/auth";
import { DocumentUploadService } from "../../services/documentUploadService";
import logger from "../../monitoring/logger";

// Extend the Express Request type to include user property
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    full_name?: string;
  };
}

const router = Router();

// Get all projects for a user
router.get(
  "/",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;

      const projects = await DocumentUploadService.getUserProjects(userId);

      res.status(200).json({
        success: true,
        data: projects,
      });
    } catch (error: any) {
      logger.error("Error fetching user projects", {
        error: error.message,
        stack: error.stack,
      });

      // Graceful degradation: Return 200 with status "unavailable"
      res.status(200).json({
        success: false,
        status: "unavailable",
        data: [],
        message: "Service temporarily unavailable. Please try again later.",
      });
    }
  }
);

// Get a specific project
router.get(
  "/:projectId",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId } = req.params;
      const userId = req.user!.id;

      const project = await DocumentUploadService.getProjectById(
        projectId as string,
        userId
      );

      if (!project) {
        return res.status(404).json({
          success: false,
          error: "Project not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: project,
      });
    } catch (error: any) {
      logger.error("Error fetching project", {
        error: error.message,
        stack: error.stack,
        projectId: req.params.projectId,
      });

      return res.status(200).json({
        success: false,
        status: "unavailable",
        data: null,
        message: "Service temporarily unavailable. Please try again later.",
      });
    }
  }
);

// Update a project
router.put(
  "/:projectId",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId } = req.params;
      const { title, description, content, citation_style } = req.body as any;
      const userId = req.user!.id;

      // Validate required fields
      if (!title) {
        return res.status(400).json({ error: "Title is required" });
      }

      // Update project
      const updatedProject = await DocumentUploadService.updateProject(
        projectId as string,
        userId,
        title,
        description || "",
        content,
        content ? JSON.stringify(content).length : 0,
        citation_style
      );

      if (!updatedProject) {
        return res.status(404).json({
          success: false,
          error: "Project not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: updatedProject,
      });
    } catch (error: any) {
      logger.error("Error updating project", {
        error: error.message,
        stack: error.stack,
        projectId: req.params.projectId,
      });

      return res.status(200).json({
        success: false,
        status: "unavailable",
        message: "Service temporarily unavailable. Please try again later.",
      });
    }
  }
);

// Delete a project
router.delete(
  "/:projectId",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId } = req.params;
      const userId = req.user!.id;

      // Delete project
      const deletedProject = await DocumentUploadService.deleteProject(
        projectId as string,
        userId
      );

      return res.status(200).json({
        success: true,
        data: deletedProject,
        message: "Project deleted successfully",
      });
    } catch (error: any) {
      logger.error("Error deleting project", {
        error: error.message,
        stack: error.stack,
        projectId: req.params.projectId,
      });

      return res.status(200).json({
        success: false,
        status: "unavailable",
        message: "Service temporarily unavailable. Please try again later.",
      });
    }
  }
);

export default router;
