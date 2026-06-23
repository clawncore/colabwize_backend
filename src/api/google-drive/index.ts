import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";
import { GoogleDriveService } from "../../services/googleDriveService";
import { DocumentUploadService } from "../../services/documentUploadService";
import { SupabaseStorageService } from "../../services/supabaseStorageService";
import { StorageService } from "../../services/storageService";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import { pipeline, Readable } from "stream";

const streamPipeline = promisify(pipeline);

const listLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  message: { error: "Too many list requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
} as any);

const importLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,
  message: { error: "Too many import requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
} as any);

const router = express.Router();

/**
 * GET /api/google-drive/list
 * List files from Google Drive
 */
router.get("/list", authenticateHybridRequest, listLimiter, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const { folderId } = req.query;

    const files = await GoogleDriveService.listFiles(userId, folderId as string);
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
    res.set("Pragma", "no-cache");
    return res.status(200).json(files);
  } catch (error: any) {
    logger.error("[Google Drive List Error]:", error.message);

    // Return specific status codes for common errors
    if (error.message?.includes("not connected") || error.message?.includes("refresh")) {
      return res.status(401).json({ error: "Google Drive not connected or token expired. Please reconnect your account." });
    }
    if (error.code === 401 || error.status === 401) {
      return res.status(401).json({ error: "Google Drive authentication failed. Please reconnect your account." });
    }
    if (error.code === 403 || error.status === 403) {
      return res.status(403).json({ error: "Google Drive access denied. Please check your permissions." });
    }
    if (error.code === 429 || error.status === 429) {
      return res.status(429).json({ error: "Google Drive rate limit exceeded. Please try again later." });
    }

    return res.status(500).json({ error: error.message || "Failed to list Google Drive files." });
  }
});

/**
 * POST /api/google-drive/create-project
 * Create a new project from a Google Drive file
 */
router.post("/create-project", authenticateHybridRequest, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { fileId, title, description, workspaceId } = req.body;

    if (!fileId || !title) {
      return res.status(400).json({ error: "Missing fileId or title" });
    }

    // 1. Get file metadata and content
    const { stream, fileName, mimeType } = await GoogleDriveService.getFileContent(userId, fileId);

    // 2. Prepare temporary path
    const uploadDir = path.join(__dirname, "../../../../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const tempFileName = `${Date.now()}-${fileName}`;
    const tempPath = path.join(uploadDir, tempFileName);

    // 3. Save stream to disk
    await streamPipeline(stream, fs.createWriteStream(tempPath));

    // 4. Create dummy Multer file object
    const file: any = {
      path: tempPath,
      originalname: fileName,
      mimetype: mimeType,
      size: fs.statSync(tempPath).size,
      filename: tempFileName,
    };

    // 5. Create project
    const project = await DocumentUploadService.createProjectWithDocument(
      userId,
      title,
      description || "",
      file,
      workspaceId,
      'google-drive'
    );

    return res.status(201).json({ success: true, data: project });
  } catch (error: any) {
    logger.error("[Google Drive Create Project Error]:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/google-drive/download/:fileId
 * Download a file from Google Drive
 */
router.get("/download/:fileId", authenticateHybridRequest, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { fileId } = req.params;

    const { stream, fileName, mimeType } = await GoogleDriveService.getFileContent(userId, fileId as string);

    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    
    stream.pipe(res);
  } catch (error: any) {
    logger.error("[Google Drive Download Error]:", error.message);
    return res.status(500).json({ error: "Failed to download file from Google Drive" });
  }
});

/**
 * POST /api/google-drive/import
 * Import a file from Google Drive to the project library
 */
router.post("/import", authenticateHybridRequest, importLimiter, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { projectId, fileId } = req.body;

    if (!projectId || !fileId) {
      return res.status(400).json({ error: "Missing projectId or fileId" });
    }

    // 1. Get file content stream from Google Drive
    const { stream: gdStream, fileName, mimeType } = await GoogleDriveService.getFileContent(userId, fileId);

    if (!fileName) {
      return res.status(400).json({ error: "Could not determine file name from Google Drive" });
    }

    const safeMimeType = mimeType || 'application/octet-stream';

    // 2. Stream to a temporary file to determine size and allow re-reading
    const uploadDir = path.join(__dirname, "../../../../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const tempFileName = `gd-import-${Date.now()}-${fileName}`;
    const tempPath = path.join(uploadDir, tempFileName);

    await streamPipeline(gdStream, fs.createWriteStream(tempPath));

    const fileSize = fs.statSync(tempPath).size;

    // 3. Check storage limit
    const storageInfo = await StorageService.getUserStorageInfo(userId);
    const fileSizeInMB = fileSize / (1024 * 1024);
    const newStorageUsed = storageInfo.used + fileSizeInMB;

    if (newStorageUsed > storageInfo.limit) {
      fs.unlinkSync(tempPath);
      return res.status(400).json({
        error: "Storage limit exceeded. Please upgrade your plan for more space."
      });
    }

    // 4. Upload from temp file using stream
    const readStream = fs.createReadStream(tempPath);
    const uploadResult = await SupabaseStorageService.uploadFileStream(
      readStream,
      fileName,
      safeMimeType,
      userId,
      {
        userId,
        fileName,
        fileType: safeMimeType,
        fileSize,
        projectId: projectId as string,
        createdAt: new Date(),
      }
    );

    // 5. Clean up temp file
    fs.unlinkSync(tempPath);

    // 6. Create file record in database
    const fileRecord = await prisma.file.create({
      data: {
        user_id: userId,
        project_id: projectId as string,
        file_name: fileName,
        file_path: uploadResult.path,
        file_type: safeMimeType,
        file_size: fileSize,
        metadata: {
          source: 'google-drive',
          originalFileId: fileId,
          publicUrl: uploadResult.publicUrl,
        },
      },
    });

    // 7. Update user's storage usage
    await prisma.user.update({
      where: { id: userId },
      data: {
        storage_used: newStorageUsed,
      },
    });

    logger.info("Google Drive file imported successfully", {
      userId,
      projectId,
      fileId: fileRecord.id,
      fileName,
      fileSize,
    });

    return res.status(200).json({
      success: true,
      message: "File imported successfully",
      data: {
        id: fileRecord.id,
        fileName: fileRecord.file_name,
        fileType: fileRecord.file_type,
        fileSize: fileRecord.file_size,
      },
    });
  } catch (error: any) {
    logger.error("[Google Drive Import Error]:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
