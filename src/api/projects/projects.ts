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

// Get all projects for a user (with optional workspace filtering)
router.get(
  "/",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;
      const workspaceId = req.query.workspaceId as string | undefined;
      const fetchArchived = req.query.archived === "true";

      let projects;
      if (workspaceId === "null") {
        // Personal projects only (no workspace)
        projects = await DocumentUploadService.getUserProjects(userId, {
          personalOnly: true,
          fetchArchived,
        });
      } else if (workspaceId) {
        // Projects in a specific workspace
        projects = await DocumentUploadService.getUserProjects(userId, {
          workspaceId,
          fetchArchived,
        });
      } else {
        // All projects (default, backward compatible)
        projects = await DocumentUploadService.getUserProjects(userId, {
          fetchArchived,
        });
      }

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
  },
);

// Export a project (Common GET for direct download)
router.get(
  "/export",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const {
        projectId,
        format,
        includeCitations,
        includeComments,
        citationStyle,
        template,
      } = req.query;
      const userId = req.user!.id;

      if (!projectId) {
        return res.status(400).json({ error: "Project ID is required" });
      }

      const { ExportService } = await import("../../services/exportService.js");

      if (format === "docx" || format === "word") {
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="export-${projectId}.docx"`,
        );
      } else if (format === "pdf") {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="export-${projectId}.pdf"`,
        );
      } else {
        return res.status(400).json({ error: "Invalid format specified" });
      }

      const exportResult = await ExportService.exportProject(
        projectId as string,
        userId,
        {
          format: format as "docx" | "pdf",
          includeCitations: includeCitations === "true",
          includeComments: includeComments === "true",
          citationStyle: citationStyle as string,
          journalTemplate: template as string,
        },
      );

      return res.send(exportResult.buffer);
    } catch (error: any) {
      logger.error("Error exporting project", {
        error: error.message,
        stack: error.stack,
        projectId: req.query.projectId,
      });
      return res
        .status(500)
        .json({ error: "Failed to export project: " + error.message });
    }
  },
);

// Cloud Export: Google Drive
router.post(
  "/export/google-drive",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, format = "pdf", htmlContent, metadata } = req.body;
      const userId = req.user!.id;

      if (!projectId || !htmlContent) {
        return res
          .status(400)
          .json({ error: "Missing projectId or htmlContent" });
      }

      const { ExportService } = await import("../../services/exportService.js");
      const { GoogleDriveService } =
        await import("../../services/googleDriveService.js");

      // 1. Generate the file buffer
      const exportResult = await ExportService.exportProject(
        projectId,
        userId,
        {
          format: format as any,
          htmlContent,
          metadata,
        },
      );

      // 2. Upload to Google Drive
      const fileName = `${metadata?.title || "Exported Document"}.${format}`;
      const mimeType =
        format === "pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

      const gDriveResult = await GoogleDriveService.uploadFile(
        userId,
        fileName,
        exportResult.buffer,
        mimeType,
      );

      return res.status(200).json({
        success: true,
        message: "Project successfully exported to Google Drive",
        url: gDriveResult.webViewLink,
        data: gDriveResult,
      });
    } catch (error: any) {
      logger.error("Error exporting to Google Drive", {
        error: error.message,
        userId: req.user?.id,
      });
      return res.status(500).json({ success: false, message: error.message });
    }
  },
);

// Cloud Export: Zotero
router.post(
  "/export/zotero",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, metadata } = req.body;
      const userId = req.user!.id;

      const { ZoteroService } = await import("../../services/zoteroService.js");
      const { prisma } = await import("../../lib/prisma.js");

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { zotero_api_key: true, zotero_user_id: true },
      });

      if (!user?.zotero_api_key || !user?.zotero_user_id) {
        return res.status(401).json({ error: "Zotero account not linked" });
      }

      // Prepare Zotero item (Metadata Only as requested)
      const itemData = {
        itemType: "journalArticle",
        title: metadata?.title || "Untitled Paper",
        creators: (metadata?.author || "")
          .split(",")
          .map((name: string) => ({
            creatorType: "author",
            name: name.trim(),
          }))
          .filter((c: any) => c.name),
        abstractNote: metadata?.abstract || "",
        date: metadata?.date || new Date().toISOString(),
        libraryCatalog: "ColabWize",
        url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/dashboard/editor/${projectId}`,
      };

      const result = await ZoteroService.createItem(
        user.zotero_user_id,
        user.zotero_api_key,
        itemData,
      );

      return res.status(200).json({
        success: true,
        message: "Metadata successfully exported to Zotero",
        data: result,
      });
    } catch (error: any) {
      logger.error("Error exporting to Zotero", {
        error: error.message,
        userId: req.user?.id,
      });
      return res.status(500).json({ success: false, message: error.message });
    }
  },
);

// Cloud Export: Mendeley
router.post(
  "/export/mendeley",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId, metadata } = req.body;
      const userId = req.user!.id;

      const { MendeleyService } =
        await import("../../services/mendeleyService.js");

      // Prepare Mendeley item (Metadata Only as requested)
      const itemData = {
        type: "journal",
        title: metadata?.title || "Untitled Paper",
        authors: (metadata?.author || "").split(",").map((name: string) => {
          const parts = name.trim().split(" ");
          return {
            first_name: parts[0] || "",
            last_name: parts.slice(1).join(" ") || "Author",
          };
        }),
        abstract: metadata?.abstract || "",
        year: metadata?.date
          ? new Date(metadata.date).getFullYear()
          : new Date().getFullYear(),
        websites: [
          `${process.env.FRONTEND_URL || "http://localhost:3000"}/dashboard/editor/${projectId}`,
        ],
      };

      const result = await MendeleyService.createDocument(userId, itemData);

      return res.status(200).json({
        success: true,
        message: "Metadata successfully exported to Mendeley",
        data: result,
      });
    } catch (error: any) {
      logger.error("Error exporting to Mendeley", {
        error: error.message,
        userId: req.user?.id,
      });
      return res.status(500).json({ success: false, message: error.message });
    }
  },
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
        userId,
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
  },
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
        citation_style,
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
  },
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
        userId,
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
  },
);

export default router;
