import { Router, Request, Response } from "express";
import { authenticateExpressRequest } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { SupabaseStorageService } from "../../services/supabaseStorageService";

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    full_name?: string;
  };
}

const router = Router();

/**
 * GET /api/files/:id/serve
 * Serve a file for download
 */
router.get(
  "/:id/serve",
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

      // Download the file from Supabase storage
      try {
        const fileBuffer = await SupabaseStorageService.downloadFile(
          file.file_path
        );

        // Set appropriate headers for file download
        res.setHeader("Content-Type", file.file_type);
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${file.file_name}"`
        );
        res.setHeader("Content-Length", file.file_size.toString());

        // Send the file buffer
        res.send(fileBuffer);
      } catch (downloadError: any) {
        logger.error("Error downloading file from Supabase", {
          error: downloadError.message,
          fileId,
          filePath: file.file_path,
        });

        return res.status(404).json({
          success: false,
          message: "File not found in storage",
        });
      }

      // Log the download
      logger.info("File served for download", {
        fileId,
        userId,
        fileName: file.file_name,
      });

      return;
    } catch (error: any) {
      logger.error("Serve file error", {
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
