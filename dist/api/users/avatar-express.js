"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadAvatar = uploadAvatar;
const prisma_1 = require("../../lib/prisma");
const supabaseStorageService_1 = require("../../services/supabaseStorageService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
// Upload avatar - Express version
async function uploadAvatar(req, res) {
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
            const uploadResult = await supabaseStorageService_1.SupabaseStorageService.uploadFile(file.buffer, file.originalname, file.mimetype, userId, {
                userId: userId,
                fileName: file.originalname,
                fileType: file.mimetype,
                fileSize: file.size,
                createdAt: new Date(),
            });
            // Update user's avatar URL in the database
            await prisma_1.prisma.user.update({
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
        }
        catch (uploadError) {
            logger_1.default.error("Avatar upload error", {
                error: uploadError.message,
                userId: userId,
            });
            return res.status(500).json({
                error: "Failed to upload avatar: " + uploadError.message,
            });
        }
    }
    catch (error) {
        console.error("Error uploading avatar:", error);
        return res.status(500).json({ error: "Internal server error" });
    }
}
