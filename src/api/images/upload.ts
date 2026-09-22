import express, { Response } from "express";
import { ImageUploadService } from "../../services/ImageUploadService";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { authenticateExpressRequest } from "../../middleware/auth";

const router = express.Router();

// Robust multer initialization
let upload: any;

try {
    // Determine environment-specific import
    // Using require to avoid top-level import crashes
    const multer = require("multer");

    // Configure multer for memory storage
    upload = multer({
        storage: multer.memoryStorage(),
        limits: {
            fileSize: 5 * 1024 * 1024, // 5MB
        },
        fileFilter: (_req: any, file: any, cb: any) => {
            // F-28: Validate MIME against magic bytes before accepting the upload.
            // Multer's fileFilter runs before the buffer is read, so we do a
            // lightweight header check here and a full magic-byte validation in
            // the upload handler below.
            const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
            if (allowedMimes.includes(file.mimetype)) {
                cb(null, true);
            } else {
                cb(new Error("Invalid file type. Only JPEG, PNG, and WebP are allowed."));
            }
        },
    });
    logger.info("✅ Multer initialized successfully");
} catch (error: any) {
    logger.error("❌ Failed to initialize multer:", { error: error.message });
    // Fallback: Dummy middleware that rejects uploads safely
    upload = {
        single: (_fieldName: string) => (req: any, res: Response, next: any) => {
            return res.status(503).json({
                success: false,
                message: "Image upload service is currently unavailable (Multer init failed)"
            });
        }
    };
}

interface AuthenticatedRequest extends express.Request {
    user?: {
        id: string;
        email: string;
    };
}

/**
 * F-28: Validate the uploaded buffer's magic bytes against the declared MIME.
 * Rejects files whose content does not match the claimed type, preventing
 * parser confusion and MIME spoofing.
 */
function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
    if (buffer.length < 8) return false;
    // JPEG: FF D8 FF
    if (mimeType === "image/jpeg") {
        return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    }
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (mimeType === "image/png") {
        return (
            buffer[0] === 0x89 &&
            buffer[1] === 0x50 &&
            buffer[2] === 0x4e &&
            buffer[3] === 0x47 &&
            buffer[4] === 0x0d &&
            buffer[5] === 0x0a &&
            buffer[6] === 0x1a &&
            buffer[7] === 0x0a
        );
    }
    // WebP: RIFF....WEBP
    if (mimeType === "image/webp") {
        return (
            buffer[0] === 0x52 && // R
            buffer[1] === 0x49 && // I
            buffer[2] === 0x46 && // F
            buffer[3] === 0x46 && // F
            buffer.subarray(8, 12).toString("ascii") === "WEBP"
        );
    }
    return false;
}

/**
 * F-26: Verify the requesting user owns/has access to the project before
 * associating an uploaded file with it. "default" is a special personal
 * namespace that always belongs to the caller.
 */
async function validateProjectOwnership(
    projectId: string,
    userId: string,
): Promise<boolean> {
    if (!projectId || projectId === "default") return true;
    const project = await prisma.project.findFirst({
        where: { id: projectId, user_id: userId },
        select: { id: true },
    });
    return !!project;
}

/**
 * POST /api/images/upload
 * Upload an image to Supabase storage
 */
router.post(
    "/upload",
    authenticateExpressRequest,
    upload.single("image"),
    async (req: AuthenticatedRequest, res: Response) => {
        try {
            const userId = req.user?.id;

            if (!userId) {
                return res.status(401).json({
                    success: false,
                    message: "Authentication required",
                });
            }

            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: "No image file provided",
                });
            }

            // F-28: Magic-byte validation — reject files whose content does not
            // match the declared MIME type.
            if (!validateMagicBytes(req.file.buffer, req.file.mimetype)) {
                return res.status(400).json({
                    success: false,
                    message:
                        "File content does not match the declared MIME type. Upload rejected.",
                });
            }

            const projectId = req.body.projectId || "default";

            // F-26: Validate project ownership before associating the file.
            const hasAccess = await validateProjectOwnership(projectId, userId);
            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    message: "Access denied: project not found or not owned by caller.",
                });
            }

            // Upload to Supabase
            const url = await ImageUploadService.uploadImage(
                req.file.buffer,
                userId,
                projectId,
                req.file.mimetype
            );

            return res.status(200).json({
                success: true,
                url,
                message: "Image uploaded successfully",
            });
        } catch (error: any) {
            logger.error("Image upload API error", {
                error: error.message,
                userId: req.user?.id,
            });

            return res.status(500).json({
                success: false,
                message: "Failed to upload image",
            });
        }
    }
);

/**
 * DELETE /api/images/:imagePath
 * Delete an image from Supabase storage
 */
router.delete("/:imagePath", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const userId = req.user?.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }

        const imageUrl = decodeURIComponent(
            Array.isArray(req.params.imagePath)
                ? req.params.imagePath[0]
                : req.params.imagePath
        );

        await ImageUploadService.deleteImage(imageUrl, userId);

        return res.status(200).json({
            success: true,
            message: "Image deleted successfully",
        });
    } catch (error: any) {
        logger.error("Image deletion API error", {
            error: error.message,
            userId: req.user?.id,
        });

        return res.status(500).json({
            success: false,
            message: "Failed to delete image",
        });
    }
});

export default router;
