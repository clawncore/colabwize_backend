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

const UPLOAD_DIR = path.join(__dirname, "../../../../uploads");

function ensureUploadDir(): void {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

const listLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  message: { error: "Too many list requests. Please slow down." },
  standardHeaders: true, legacyHeaders: false,
});

const importLimiter = rateLimit({
  windowMs: 60 * 1000, max: 30,
  message: { error: "Too many import requests. Please slow down." },
  standardHeaders: true, legacyHeaders: false,
});

const router = express.Router();

/** GET /api/onedrive/list — List files from OneDrive */
router.get("/list", authenticateHybridRequest, listLimiter, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const { folderId, pageToken } = req.query;
    const result = await OneDriveService.listFiles(userId, folderId as string | undefined, pageToken as string | undefined);
    return res.status(200).json(result);
  } catch (error: any) {
    logger.error("[OneDrive List Error]:", error.message);
    return handleCloudError(res, error);
  }
});

/** POST /api/onedrive/create-project — Create a new project from a OneDrive file */
router.post("/create-project", authenticateHybridRequest, async (req: Request, res: Response) => {
  let tempPath: string | null = null;
  try {
    const userId = (req as any).user.id;
    const { fileId, title, description, workspaceId } = req.body;

    if (!fileId || !title) {
      return res.status(400).json({ error: "Missing fileId or title" });
    }

    const { stream, fileName, mimeType } = await OneDriveService.getFileContent(userId, fileId);

    ensureUploadDir();
    const tempFileName = `od-${Date.now()}-${fileName}`;
    tempPath = path.join(UPLOAD_DIR, tempFileName);
    await streamPipeline(stream, fs.createWriteStream(tempPath));

    const file: any = {
      path: tempPath, originalname: fileName, mimetype: mimeType,
      size: fs.statSync(tempPath).size, filename: path.basename(tempPath),
    };

    const project = await DocumentUploadService.createProjectWithDocument(
      userId, title, description || "", file, workspaceId, "onedrive",
    );

    return res.status(201).json({ success: true, data: project });
  } catch (error: any) {
    logger.error("[OneDrive Create Project Error]:", error.message);
    return handleCloudError(res, error);
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch { /* best-effort */ }
    }
  }
});

/** GET /api/onedrive/download/:fileId — Download a file from OneDrive */
router.get("/download/:fileId", authenticateHybridRequest, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { stream, fileName, mimeType } = await OneDriveService.getFileContent(userId, req.params.fileId as string);
    res.setHeader("Content-Type", mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    stream.pipe(res);
  } catch (error: any) {
    logger.error("[OneDrive Download Error]:", error.message);
    return handleCloudError(res, error);
  }
});

/** GET /api/onedrive/status — Check if OneDrive connection is still valid */
router.get("/status", authenticateHybridRequest, async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  try {
    const result = await OneDriveService.listFiles(userId, undefined, undefined, 1);
    return res.status(200).json({ connected: true, filesCount: result.files.length });
  } catch (error: any) {
    return res.status(200).json({ connected: false, error: "Connection invalid. Please reconnect." });
  }
});

/** POST /api/onedrive/import — Import a file from OneDrive to the project library */
router.post("/import", authenticateHybridRequest, importLimiter, async (req: Request, res: Response) => {
  let tempPath: string | null = null;
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

    ensureUploadDir();
    const tempFileName = `od-import-${Date.now()}-${fileName}`;
    tempPath = path.join(UPLOAD_DIR, tempFileName);
    await streamPipeline(odStream, fs.createWriteStream(tempPath));

    const fileSize = fs.statSync(tempPath).size;

    const storageInfo = await StorageService.getUserStorageInfo(userId);
    const fileSizeInMB = fileSize / (1024 * 1024);
    const newStorageUsed = storageInfo.used + fileSizeInMB;

    if (newStorageUsed > storageInfo.limit) {
      return res.status(400).json({ error: "Storage limit exceeded. Please upgrade your plan for more space." });
    }

    const readStream = fs.createReadStream(tempPath);
    const uploadResult = await SupabaseStorageService.uploadFileStream(
      readStream, fileName, safeMimeType, userId,
      { userId, fileName, fileType: safeMimeType, fileSize, projectId: projectId as string, createdAt: new Date() },
    );

    const fileRecord = await prisma.file.create({
      data: {
        user_id: userId, project_id: projectId as string, file_name: fileName,
        file_path: uploadResult.path, file_type: safeMimeType, file_size: fileSize,
        metadata: { source: "onedrive", originalFileId: fileId, publicUrl: uploadResult.publicUrl },
      },
    });

    await prisma.user.update({ where: { id: userId }, data: { storage_used: newStorageUsed } });

    logger.info("OneDrive file imported successfully", { userId, projectId, fileId: fileRecord.id, fileName, fileSize });

    return res.status(200).json({
      success: true, message: "File imported successfully",
      data: { id: fileRecord.id, fileName: fileRecord.file_name, fileType: fileRecord.file_type, fileSize: fileRecord.file_size },
    });
  } catch (error: any) {
    logger.error("[OneDrive Import Error]:", error.message);
    return handleCloudError(res, error);
  } finally {
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch { /* best-effort */ }
    }
  }
});

/** Unified cloud error handler */
function handleCloudError(res: Response, error: any): Response {
  const msg = error.message || String(error);
  if (msg.includes("not connected") || msg.includes("token") || msg.includes("reconnect")) {
    return res.status(401).json({ error: msg });
  }
  if (msg.includes("rate limit") || msg.includes("quota")) {
    return res.status(429).json({ error: msg });
  }
  if (msg.includes("denied") || msg.includes("forbidden") || msg.includes("permission")) {
    return res.status(403).json({ error: msg });
  }
  if (msg.includes("not found")) {
    return res.status(404).json({ error: msg });
  }
  if (msg.includes("too large")) {
    return res.status(413).json({ error: msg });
  }
  return res.status(500).json({ error: msg });
}

export default router;
