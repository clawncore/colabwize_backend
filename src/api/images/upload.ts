import express, { Response } from "express";
import multer from "multer";
import { ImageUploadService } from "../../services/ImageUploadService";
import logger from "../../monitoring/logger";

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
    },
    fileFilter: (_req, file, cb) => {
        const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
        if (allowedMimes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Invalid file type. Only JPEG, PNG, and WebP are allowed."));
        }
    },
});

interface AuthenticatedRequest extends express.Request {
    user?: {
        id: string;
        email: string;
    };
}

/**
 * POST /api/images/upload
 * Upload an image to Supabase storage
 */
router.post(
    "/upload",
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

            const projectId = req.body.projectId || "default";

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
                message: error.message || "Failed to upload image",
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
            message: error.message || "Failed to delete image",
        });
    }
});

export default router;
