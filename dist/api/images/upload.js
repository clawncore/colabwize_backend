"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ImageUploadService_1 = require("../../services/ImageUploadService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = express_1.default.Router();
// Robust multer initialization
let upload;
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
        fileFilter: (_req, file, cb) => {
            const allowedMimes = ["image/jpeg", "image/png", "image/webp"];
            if (allowedMimes.includes(file.mimetype)) {
                cb(null, true);
            }
            else {
                cb(new Error("Invalid file type. Only JPEG, PNG, and WebP are allowed."));
            }
        },
    });
    logger_1.default.info("✅ Multer initialized successfully");
}
catch (error) {
    logger_1.default.error("❌ Failed to initialize multer:", { error: error.message });
    // Fallback: Dummy middleware that rejects uploads safely
    upload = {
        single: (_fieldName) => (req, res, next) => {
            return res.status(503).json({
                success: false,
                message: "Image upload service is currently unavailable (Multer init failed)"
            });
        }
    };
}
const auth_1 = require("../../middleware/auth");
/**
 * POST /api/images/upload
 * Upload an image to Supabase storage
 */
router.post("/upload", auth_1.authenticateExpressRequest, upload.single("image"), async (req, res) => {
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
        const url = await ImageUploadService_1.ImageUploadService.uploadImage(req.file.buffer, userId, projectId, req.file.mimetype);
        return res.status(200).json({
            success: true,
            url,
            message: "Image uploaded successfully",
        });
    }
    catch (error) {
        logger_1.default.error("Image upload API error", {
            error: error.message,
            userId: req.user?.id,
        });
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to upload image",
        });
    }
});
/**
 * DELETE /api/images/:imagePath
 * Delete an image from Supabase storage
 */
router.delete("/:imagePath", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const imageUrl = decodeURIComponent(Array.isArray(req.params.imagePath)
            ? req.params.imagePath[0]
            : req.params.imagePath);
        await ImageUploadService_1.ImageUploadService.deleteImage(imageUrl, userId);
        return res.status(200).json({
            success: true,
            message: "Image deleted successfully",
        });
    }
    catch (error) {
        logger_1.default.error("Image deletion API error", {
            error: error.message,
            userId: req.user?.id,
        });
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to delete image",
        });
    }
});
exports.default = router;
