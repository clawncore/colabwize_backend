import { Router, Request, Response } from "express";
import multer from "multer";
import { authenticateExpressRequest } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { StorageService } from "../../services/storageService";
import { SupabaseStorageService } from "../../services/supabaseStorageService";
import { v4 as uuidv4 } from "uuid";
import path from "path";

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    full_name?: string;
  };
}

const router = Router();

// Use memory storage to store files temporarily in memory before uploading to Supabase
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Allow only specific file types
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "application/zip",
      "application/x-zip-compressed",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "text/csv",
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "text/x-tex",
      "text/rtf",
      "application/rtf",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Invalid file type. Only PDF, DOC, DOCX, TXT, ZIP, Excel, CSV, and images are allowed."
        )
      );
    }
  },
});

/**
 * POST /api/files/upload
 * Upload a file to the system
 */
router.post(
  "/upload",
  authenticateExpressRequest,
  upload.single("file"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      const { projectId, fileName, description } = req.body;

      // Validate user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check storage limit
      const storageInfo = await StorageService.getUserStorageInfo(userId);
      const fileSizeInMB = req.file.size / (1024 * 1024);
      const newStorageUsed = storageInfo.used + fileSizeInMB;

      if (newStorageUsed > storageInfo.limit) {
        return res.status(400).json({
          success: false,
          message: "Storage limit exceeded",
        });
      }

      // Upload file to Supabase storage
      const uploadResult = await SupabaseStorageService.uploadFile(
        req.file.buffer,
        fileName || req.file.originalname,
        req.file.mimetype,
        userId,
        {
          userId,
          fileName: fileName || req.file.originalname,
          fileType: req.file.mimetype,
          fileSize: req.file.size,
          projectId: projectId || undefined,
          createdAt: new Date(),
        }
      );

      // Create file record in database
      const fileRecord = await prisma.file.create({
        data: {
          user_id: userId,
          project_id: projectId || null,
          file_name: fileName || req.file.originalname,
          file_path: uploadResult.path,
          file_type: req.file.mimetype,
          file_size: req.file.size,
          metadata: {
            originalName: req.file.originalname,
            encoding: req.file.encoding,
            destination: req.file.destination,
            publicUrl: uploadResult.publicUrl,
          },
        },
      });

      // Update user's storage usage
      await prisma.user.update({
        where: { id: userId },
        data: {
          storage_used: newStorageUsed,
        },
      });

      logger.info("File uploaded successfully", {
        fileId: fileRecord.id,
        userId,
        fileName: fileRecord.file_name,
        fileSize: req.file.size,
      });

      return res.status(200).json({
        success: true,
        message: "File uploaded successfully",
        data: {
          id: fileRecord.id,
          fileName: fileRecord.file_name,
          filePath: fileRecord.file_path,
          fileType: fileRecord.file_type,
          fileSize: fileRecord.file_size,
          uploadedAt: fileRecord.created_at,
        },
      });
    } catch (error: any) {
      logger.error("File upload error", {
        error: error.message,
        stack: error.stack,
      });

      // Clean up uploaded file if there was an error
      if (req.file && req.file.path) {
        // In a real implementation, you'd want to delete the file here
        // fs.unlinkSync(req.file.path);
      }

      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    }
  }
);

/**
 * POST /api/files/upload-with-project
 * Upload a file and associate it with a new project
 */
router.post(
  "/upload-with-project",
  authenticateExpressRequest,
  upload.single("file"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // Check if file was uploaded
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
        });
      }

      const { projectName, projectDescription, citationStyle } = req.body;

      // Validate user exists
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      // Check storage limit
      const storageInfo = await StorageService.getUserStorageInfo(userId);
      const fileSizeInMB = req.file.size / (1024 * 1024);
      const newStorageUsed = storageInfo.used + fileSizeInMB;

      if (newStorageUsed > storageInfo.limit) {
        return res.status(400).json({
          success: false,
          message: "Storage limit exceeded",
        });
      }

      // Create a new project
      const project = await prisma.project.create({
        data: {
          user_id: userId,
          title: projectName || path.parse(req.file.originalname).name,
          description: projectDescription || "",
          citation_style: citationStyle || "apa",
        },
      });

      // Upload file to Supabase storage
      const uploadResult = await SupabaseStorageService.uploadFile(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        userId,
        {
          userId,
          fileName: req.file.originalname,
          fileType: req.file.mimetype,
          fileSize: req.file.size,
          projectId: project.id,
          createdAt: new Date(),
        }
      );

      // Create file record associated with the project
      const fileRecord = await prisma.file.create({
        data: {
          user_id: userId,
          project_id: project.id,
          file_name: req.file.originalname,
          file_path: uploadResult.path,
          file_type: req.file.mimetype,
          file_size: req.file.size,
          metadata: {
            originalName: req.file.originalname,
            encoding: req.file.encoding,
            destination: req.file.destination,
            publicUrl: uploadResult.publicUrl,
          },
        },
      });

      // Update user's storage usage
      await prisma.user.update({
        where: { id: userId },
        data: {
          storage_used: newStorageUsed,
        },
      });

      logger.info("File uploaded and associated with new project", {
        fileId: fileRecord.id,
        projectId: project.id,
        userId,
        fileName: fileRecord.file_name,
      });

      return res.status(200).json({
        success: true,
        message: "File uploaded and project created successfully",
        data: {
          projectId: project.id,
          fileId: fileRecord.id,
          fileName: fileRecord.file_name,
          filePath: fileRecord.file_path,
          fileSize: fileRecord.file_size,
          uploadedAt: fileRecord.created_at,
        },
      });
    } catch (error: any) {
      logger.error("File upload with project error", {
        error: error.message,
        stack: error.stack,
      });

      // Clean up uploaded file if there was an error
      if (req.file && req.file.path) {
        // In a real implementation, you'd want to delete the file here
        // fs.unlinkSync(req.file.path);
      }

      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    }
  }
);

/**
 * GET /api/files/list
 * Get list of user's files
 */
router.get(
  "/list",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const { projectId, page = 1, limit = 10 } = req.query;

      // Build query based on filters
      const whereClause: any = { user_id: userId };
      if (projectId) {
        whereClause.project_id = projectId as string;
      }

      // Get files with pagination
      const files = await prisma.file.findMany({
        where: whereClause,
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
        orderBy: {
          created_at: "desc",
        },
      });

      // Get total count for pagination
      const totalCount = await prisma.file.count({
        where: whereClause,
      });

      return res.status(200).json({
        success: true,
        data: {
          files,
          pagination: {
            currentPage: Number(page),
            totalPages: Math.ceil(totalCount / Number(limit)),
            totalItems: totalCount,
            itemsPerPage: Number(limit),
          },
        },
      });
    } catch (error: any) {
      logger.error("Get files list error", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    }
  }
);

/**
 * DELETE /api/files/:id
 * Delete a file
 */
router.delete(
  "/:id",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const fileId = req.params.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // Find the file
      const file = await prisma.file.findUnique({
        where: {
          id: fileId,
        },
      });

      if (!file) {
        return res.status(404).json({
          success: false,
          message: "File not found",
        });
      }

      // Verify ownership
      if (file.user_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Delete file record from database
      await prisma.file.delete({
        where: {
          id: fileId,
        },
      });

      // Update user's storage usage
      const fileSizeInMB = file.file_size / (1024 * 1024);
      await prisma.user.update({
        where: { id: userId },
        data: {
          storage_used: {
            decrement: fileSizeInMB,
          },
        },
      });

      // In a real implementation, you'd want to delete the physical file here
      // fs.unlinkSync(file.file_path);

      logger.info("File deleted successfully", {
        fileId,
        userId,
      });

      return res.status(200).json({
        success: true,
        message: "File deleted successfully",
      });
    } catch (error: any) {
      logger.error("Delete file error", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    }
  }
);

/**
 * GET /api/files/:id/download
 * Download a file
 */
router.get(
  "/:id/download",
  authenticateExpressRequest,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.user?.id;
      const fileId = req.params.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      // Find the file
      const file = await prisma.file.findUnique({
        where: {
          id: fileId,
        },
      });

      if (!file) {
        return res.status(404).json({
          success: false,
          message: "File not found",
        });
      }

      // Verify ownership
      if (file.user_id !== userId) {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // In a real implementation, you'd want to serve the file content here
      // For now, we'll return the file path
      return res.status(200).json({
        success: true,
        data: {
          id: file.id,
          fileName: file.file_name,
          filePath: file.file_path,
          fileType: file.file_type,
          fileSize: file.file_size,
          downloadUrl: `/api/files/${file.id}/serve`, // This would be a separate endpoint
        },
      });
    } catch (error: any) {
      logger.error("Download file error", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        message: error.message || "Internal server error",
      });
    }
  }
);

export default router;
