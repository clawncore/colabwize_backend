import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { SupabaseStorageService } from "../../services/supabaseStorageService";
import logger from "../../monitoring/logger";

// Extend the Express Request type to include user property
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    full_name?: string;
  };
}

// Upload avatar - Express version
export async function uploadAvatar(req: AuthenticatedRequest, res: Response) {
  try {
    // Get user from request (passed by auth middleware)
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const file = req.file;

    // Validate file type
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif"];
    if (!allowedTypes.includes(file.mimetype)) {
      return res.status(400).json({
        error: "Invalid file type. Only JPEG, PNG, and GIF are allowed.",
      });
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      return res.status(400).json({
        error: "File size too large. Maximum size is 5MB.",
      });
    }

    try {
      // Upload file to Supabase storage
      const uploadResult = await SupabaseStorageService.uploadFile(
        file.buffer,
        file.originalname,
        file.mimetype,
        userId,
        {
          userId: userId,
          fileName: file.originalname,
          fileType: file.mimetype,
          fileSize: file.size,
          createdAt: new Date(),
        }
      );

      // Update user's avatar URL in the database
      await prisma.user.update({
        where: { id: userId },
        data: {
          avatar_url: uploadResult.publicUrl,
          updated_at: new Date(),
        },
      });

      return res.status(200).json({
        success: true,
        fileUrl: uploadResult.publicUrl,
        message: "Avatar uploaded successfully",
      });
    } catch (uploadError: any) {
      logger.error("Avatar upload error", {
        error: uploadError.message,
        userId: userId,
      });

      return res.status(500).json({
        error: "Failed to upload avatar: " + uploadError.message,
      });
    }
  } catch (error: any) {
    console.error("Error uploading avatar:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}
