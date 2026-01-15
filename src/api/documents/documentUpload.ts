import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
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

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Create uploads directory if it doesn't exist
    const uploadDir = path.join(__dirname, "../../../../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Allowed extensions
    const allowedExtensions = [".pdf", ".docx", ".txt", ".rtf", ".odt"];
    const ext = path.extname(file.originalname).toLowerCase();

    // Check MIME type or extension
    // We prioritize extension check because some browsers/OSs/Postman might send generic MIME types
    if (allowedExtensions.includes(ext)) {
      return cb(null, true);
    }

    // Also allow by mimetype just in case
    const allowedMimeTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
      "text/plain", // txt
      "application/rtf",
      "text/rtf", // rtf
      "application/vnd.oasis.opendocument.text", // odt
      "application/octet-stream", // fallback
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      return cb(null, true);
    }

    console.log("File upload rejected:", {
      originalname: file.originalname,
      mimetype: file.mimetype,
      ext,
      allowedMimeTypes,
      allowedExtensions,
    });

    cb(
      new Error(
        "Error: Invalid file type! Only PDF, DOCX, TXT, RTF, and ODT files are allowed."
      )
    );
  },
});

// Create a new project with document upload
router.post(
  "/",
  authenticateExpressRequest,
  upload.single("document"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { title, description } = req.body;
      const userId = req.user!.id; // authenticated user ID

      // Validate required fields
      if (!title) {
        return res.status(400).json({ error: "Title is required" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "Document file is required" });
      }

      // Create project with uploaded document
      const project = await DocumentUploadService.createProjectWithDocument(
        userId,
        title,
        description || "",
        req.file
      );

      return res.status(201).json({
        success: true,
        data: project,
      });
    } catch (error: any) {
      logger.error("Error creating project with document", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error",
      });
    }
  }
);

// Get user's projects
router.get(
  "/",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user!.id;

      const projects = await DocumentUploadService.getUserProjects(userId);

      return res.status(200).json({
        success: true,
        data: projects,
      });
    } catch (error: any) {
      logger.error("Error fetching user projects", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error",
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

      logger.info(`[DEBUG] GET /api/documents/${projectId} - User: ${userId}`, {
        projectId,
        userId,
      });

      const project = await DocumentUploadService.getProjectById(
        projectId,
        userId
      );

      if (!project) {
        // DEBUG: Check if project exists at all
        const projectCheck =
          await DocumentUploadService.checkProjectExists(projectId);

        if (projectCheck) {
          logger.warn(
            `[DEBUG] Access denied for project ${projectId}. Owner: ${projectCheck.user_id}, Requesting User: ${userId}`,
            {
              projectId,
              ownerId: projectCheck.user_id,
              requestingUserId: userId,
            }
          );

          return res.status(404).json({
            success: false,
            error: "Project found but access denied (Owner mismatch)",
            debug: {
              ownerId: projectCheck.user_id,
              requestingUserId: userId,
              projectTitle: projectCheck.title,
            },
          });
        }

        logger.info(`[DEBUG] Project truly not found: ${projectId}`, {
          projectId,
          userId,
        });
        return res.status(404).json({
          success: false,
          error: "Project ID not found in database",
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

      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error",
      });
    }
  }
);

// Update a specific project
router.put(
  "/:projectId",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { projectId } = req.params;
      const { title, description, content, word_count } = req.body;
      const userId = req.user!.id;

      // Validate required fields
      if (!title) {
        return res.status(400).json({ error: "Title is required" });
      }

      // Update project
      const updatedProject = await DocumentUploadService.updateProject(
        projectId,
        userId,
        title,
        description || "",
        content,
        word_count || 0
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

      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error",
      });
    }
  }
);

// Create a new project without document upload
router.post(
  "/create",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { title, description, content } = req.body;
      const userId = req.user!.id;

      logger.info(
        `[DEBUG] POST /api/documents/create - User: ${userId}, Title: ${title}`,
        { userId, title }
      );

      // Validate required fields
      if (!title) {
        return res.status(400).json({ error: "Title is required" });
      }

      // Create project with provided content or empty content
      const project = await DocumentUploadService.createProject(
        userId,
        title,
        description || "",
        content || null
      );

      return res.status(201).json({
        success: true,
        data: project,
      });
    } catch (error: any) {
      logger.error("Error creating project", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        error: error.message || "Internal server error",
      });
    }
  }
);

export default router;
