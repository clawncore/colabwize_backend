"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const supabaseStorageService_1 = require("../../services/supabaseStorageService");
const router = (0, express_1.Router)();
/**
 * GET /api/files/:id/serve
 * Serve a file for download
 */
router.get("/:id/serve", auth_1.authenticateExpressRequest, async (req, res) => {
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
        const file = await prisma_1.prisma.file.findUnique({
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
            const fileBuffer = await supabaseStorageService_1.SupabaseStorageService.downloadFile(file.file_path);
            // Set appropriate headers for file download
            res.setHeader("Content-Type", file.file_type);
            res.setHeader("Content-Disposition", `attachment; filename="${file.file_name}"`);
            res.setHeader("Content-Length", file.file_size.toString());
            // Send the file buffer
            res.send(fileBuffer);
        }
        catch (downloadError) {
            logger_1.default.error("Error downloading file from Supabase", {
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
        logger_1.default.info("File served for download", {
            fileId,
            userId,
            fileName: file.file_name,
        });
        return;
    }
    catch (error) {
        logger_1.default.error("Serve file error", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error",
        });
    }
});
exports.default = router;
