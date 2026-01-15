import { Router } from "express";
import path from "path";
import fs from "fs";
import formidable from "formidable";
import { authenticateExpressRequest } from "../../middleware/auth";
import logger from "../../monitoring/logger";

const router = Router();

// Public endpoint for uploading support ticket attachments
router.post("/upload", async (req, res) => {
  try {
    // Create a new formidable form instance
    const form = formidable({
      multiples: false, // Only allow single file uploads
      maxFileSize: 5 * 1024 * 1024, // 5MB limit
      uploadDir: path.join(__dirname, "../../../../uploads"), // Directory to save uploaded files
      keepExtensions: true,
    });

    // Ensure the upload directory exists
    const uploadDir = path.join(__dirname, "../../../../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    // Parse the form using a Promise wrapper
    const { fields, files } = await new Promise<{ fields: any; files: any }>(
      (resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) reject(err);
          else resolve({ fields, files });
        });
      }
    );

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

    if (!allowedTypes.includes((file as any).mimetype)) {
      // Delete the uploaded file if it's not allowed
      try {
        fs.unlinkSync((file as any).filepath);
      } catch (deleteErr) {
        logger.error("Error deleting invalid file:", deleteErr);
      }

      return res.status(400).json({
        success: false,
        message:
          "Invalid file type. Only images, PDF, and text files are allowed.",
      });
    }

    // Return the file URL - in a real implementation, this would be a public URL
    // For now, we'll return a placeholder that indicates where the file is stored
    const fileName = path.basename((file as any).filepath);
    const fileUrl = `/uploads/${fileName}`;

    return res.json({
      success: true,
      fileUrl: fileUrl,
      fileName: fileName,
      fileSize: (file as any).size,
      mimeType: (file as any).mimetype,
    });
  } catch (error) {
    logger.error("Error uploading file:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to upload file",
    });
  }
});

export default router;
