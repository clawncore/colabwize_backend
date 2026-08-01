"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const formidable_1 = __importDefault(require("formidable"));
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = (0, express_1.Router)();
// Public endpoint for uploading support ticket attachments
router.post("/upload", async (req, res) => {
    try {
        // Create a new formidable form instance
        const form = (0, formidable_1.default)({
            multiples: false, // Only allow single file uploads
            maxFileSize: 5 * 1024 * 1024, // 5MB limit
            uploadDir: path_1.default.join(__dirname, "../../../../uploads"), // Directory to save uploaded files
            keepExtensions: true,
        });
        // Ensure the upload directory exists
        const uploadDir = path_1.default.join(__dirname, "../../../../uploads");
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        // Parse the form using a Promise wrapper
        const { fields, files } = await new Promise((resolve, reject) => {
            form.parse(req, (err, fields, files) => {
                if (err)
                    reject(err);
                else
                    resolve({ fields, files });
            });
        });
        // Check if a file was uploaded
        const fileArray = Array.isArray(files.file) ? files.file : [files.file];
        const file = fileArray[0];
        if (!file) {
            return res.status(400).json({
                success: false,
                message: "No file uploaded",
            });
        }
        // Validate file type
        const allowedTypes = [
            "image/jpeg",
            "image/png",
            "image/gif",
            "image/webp",
            "application/pdf",
            "text/plain",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ];
        if (!allowedTypes.includes(file.mimetype)) {
            // Delete the uploaded file if it's not allowed
            try {
                fs_1.default.unlinkSync(file.filepath);
            }
            catch (deleteErr) {
                logger_1.default.error("Error deleting invalid file:", deleteErr);
            }
            return res.status(400).json({
                success: false,
                message: "Invalid file type. Only images, PDF, and text files are allowed.",
            });
        }
        // Return the file URL - in a real implementation, this would be a public URL
        // For now, we'll return a placeholder that indicates where the file is stored
        const fileName = path_1.default.basename(file.filepath);
        const fileUrl = `/uploads/${fileName}`;
        return res.json({
            success: true,
            fileUrl: fileUrl,
            fileName: fileName,
            fileSize: file.size,
            mimeType: file.mimetype,
        });
    }
    catch (error) {
        logger_1.default.error("Error uploading file:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to upload file",
        });
    }
});
exports.default = router;
