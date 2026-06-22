import express, { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";
import { OneDriveService } from "../../services/onedriveService";
import { DocumentUploadService } from "../../services/documentUploadService";
import { SupabaseStorageService } from "../../services/supabaseStorageService";
import { StorageService } from "../../services/storageService";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import { pipeline } from "stream";

const streamPipeline = promisify(pipeline);

const router = express.Router();

const listLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: "Too many list requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

const importLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many import requests. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /api/onedrive/list
 * List files from OneDrive
 */
router.get("/list", authenticateHybridRequest, listLimiter, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const { folderId } = req.query;
    const files = await OneDriveService.listFiles(userId, folderId as string | undefined);
    return res.status(200).json(files);
  } catch (error: any) {
    logger.error("[OneDrive List Error]:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/onedrive/create-project
 * Create a new project from a OneDrive file
 */
router.post("/create-project", authenticateHybridRequest, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { fileId, title, description, workspaceId } = req.body;

    if (!fileId || !title) {
      return res.status(400).json({ error: "Missing fileId or title" });
    }

    const { stream, fileName, mimeType } = await OneDriveService.getFileContent(userId, fileId);

    const uploadDir = path.join(__dirname, "../../../../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const tempFileName = `${Date.now()}-${fileName}`;
    const tempPath = path.join(uploadDir, tempFileName);

    await streamPipeline(stream, fs.createWriteStream(tempPath));

    const file: any = {
      path: tempPath,
      originalname: fileName,
      mimetype: mimeType,
      size: fs.statSync(tempPath).size,
      filename: tempFileName,
    };

    const project = await DocumentUploadService.createProjectWithDocument(
      userId,
      title,
      description || "",
      file,
      workspaceId,
      "onedrive",
    );

    return res.status(201).json({ success: true, data: project });
  } catch (error: any) {
    logger.error("[OneDrive Create Project Error]:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/onedrive/download/:fileId
 * Download a file from OneDrive
 */
router.get("/download/:fileId", authenticateHybridRequest, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const fileId = req.params.fileId as string;

    const { stream, fileName, mimeType } = await OneDriveService.getFileContent(userId, fileId);

    res.setHeader("Content-Type", mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    stream.pipe(res);
  } catch (error: any) {
    logger.error("[OneDrive Download Error]:", error.message);
    return res.status(500).json({ error: "Failed to download file from OneDrive" });
  }
});

/**
 * POST /api/onedrive/import
 * Import a file from OneDrive to the project library
 */
router.post("/import", authenticateHybridRequest, importLimiter, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { projectId, fileId } = req.body;

    if (!projectId || !fileId) {
      return res.status(400).json({ error: "Missing projectId or fileId" });
    }

    const { stream: odStream, fileName, mimeType } = await OneDriveService.getFileContent(userId, fileId);

    if (!fileName) {
      return res.status(400).json({ error: "Could not determine file name from OneDrive" });
    }

    const safeMimeType = mimeType || "application/octet-stream";

    // Stream to temp file
    const uploadDir = path.join(__dirname, "../../../../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    const tempFileName = `od-import-${Date.now()}-${fileName}`;
    const tempPath = path.join(uploadDir, tempFileName);

    await streamPipeline(odStream, fs.createWriteStream(tempPath));

    const fileSize = fs.statSync(tempPath).size;

    // Check storage limit
    const storageInfo = await StorageService.getUserStorageInfo(userId);
    const fileSizeInMB = fileSize / (1024 * 1024);
    const newStorageUsed = storageInfo.used + fileSizeInMB;

    if (newStorageUsed > storageInfo.limit) {
      fs.unlinkSync(tempPath);
      return res.status(400).json({
        error: "Storage limit exceeded. Please upgrade your plan for more space.",
      });
    }

    // Upload from temp file using stream
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
      },
    );

    // Clean up temp file
    fs.unlinkSync(tempPath);

    // Create file record
    const fileRecord = await prisma.file.create({
      data: {
        user_id: userId,
        project_id: projectId as string,
        file_name: fileName,
        file_path: uploadResult.path,
        file_type: safeMimeType,
        file_size: fileSize,
        metadata: {
          source: "onedrive",
          originalFileId: fileId,
          publicUrl: uploadResult.publicUrl,
        },
      },
    });

    // Update storage usage
    await prisma.user.update({
      where: { id: userId },
      data: { storage_used: newStorageUsed },
    });

    logger.info("OneDrive file imported successfully", {
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
    logger.error("[OneDrive Import Error]:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
