import express, { Response } from "express";
import { ImageUploadService } from "../../services/ImageUploadService";
import logger from "../../monitoring/logger";

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

import { authenticateExpressRequest } from "../../middleware/auth";

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
