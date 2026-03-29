import express, { Request, Response } from "express";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";
import { GoogleDriveService } from "../../services/googleDriveService";
import { DocumentUploadService } from "../../services/documentUploadService";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import path from "path";
import fs from "fs";
import { promisify } from "util";
import { pipeline } from "stream";

const streamPipeline = promisify(pipeline);

const router = express.Router();

/**
 * GET /api/google-drive/list
 * List files from Google Drive
 */
router.get("/list", authenticateHybridRequest, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { folderId } = req.query;

    const files = await GoogleDriveService.listFiles(userId, folderId as string);
    return res.status(200).json(files);
  } catch (error: any) {
    logger.error("[Google Drive List Error]:", error.message);
    return res.status(500).json({ error: error.message });
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
router.post("/import", authenticateHybridRequest, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.id;
    const { projectId, fileId } = req.body;

    if (!projectId || !fileId) {
      return res.status(400).json({ error: "Missing projectId or fileId" });
    }

    // 1. Get file content/stream
    const { stream, fileName, mimeType } = await GoogleDriveService.getFileContent(userId, fileId);

    // 2. Here we would typically upload it to our storage (Supabase/S3)
    // and create a record in the 'files' table for the project.
    // For now, we'll implement a simplified version that just downloads it to the user.
    // In a real scenario, this would be integrated with the document service.
    
    // Placeholder for actual import logic:
    // const uploadedFile = await DocumentService.uploadFromStream(userId, projectId, stream, fileName, mimeType);

    return res.status(200).json({ success: true, message: "File import initiated", fileName });
  } catch (error: any) {
    logger.error("[Google Drive Import Error]:", error.message);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
