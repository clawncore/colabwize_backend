"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const hybridAuthMiddleware_1 = require("../../middleware/hybridAuthMiddleware");
const onedriveService_1 = require("../../services/onedriveService");
const documentUploadService_1 = require("../../services/documentUploadService");
const supabaseStorageService_1 = require("../../services/supabaseStorageService");
const storageService_1 = require("../../services/storageService");
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const util_1 = require("util");
const stream_1 = require("stream");
const streamPipeline = (0, util_1.promisify)(stream_1.pipeline);
const UPLOAD_DIR = path_1.default.join(__dirname, "../../../../uploads");
function ensureUploadDir() {
    if (!fs_1.default.existsSync(UPLOAD_DIR)) {
        fs_1.default.mkdirSync(UPLOAD_DIR, { recursive: true });
    }
}
const listLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, max: 60,
    message: { error: "Too many list requests. Please slow down." },
    standardHeaders: true, legacyHeaders: false,
});
const importLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000, max: 30,
    message: { error: "Too many import requests. Please slow down." },
    standardHeaders: true, legacyHeaders: false,
});
const router = express_1.default.Router();
/** GET /api/onedrive/list — List files from OneDrive */
router.get("/list", hybridAuthMiddleware_1.authenticateHybridRequest, listLimiter, async (req, res) => {
    const userId = req.user.id;
    try {
        const { folderId, pageToken } = req.query;
        const result = await onedriveService_1.OneDriveService.listFiles(userId, folderId, pageToken);
        return res.status(200).json(result);
    }
    catch (error) {
        logger_1.default.error("[OneDrive List Error]:", error.message);
        return handleCloudError(res, error);
    }
});
/** POST /api/onedrive/create-project — Create a new project from a OneDrive file */
router.post("/create-project", hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    let tempPath = null;
    try {
        const userId = req.user.id;
        const { fileId, title, description, workspaceId } = req.body;
        if (!fileId || !title) {
            return res.status(400).json({ error: "Missing fileId or title" });
        }
        const { stream, fileName, mimeType } = await onedriveService_1.OneDriveService.getFileContent(userId, fileId);
        ensureUploadDir();
        const tempFileName = `od-${Date.now()}-${fileName}`;
        tempPath = path_1.default.join(UPLOAD_DIR, tempFileName);
        await streamPipeline(stream, fs_1.default.createWriteStream(tempPath));
        const file = {
            path: tempPath, originalname: fileName, mimetype: mimeType,
            size: fs_1.default.statSync(tempPath).size, filename: path_1.default.basename(tempPath),
        };
        const project = await documentUploadService_1.DocumentUploadService.createProjectWithDocument(userId, title, description || "", file, workspaceId, "onedrive");
        return res.status(201).json({ success: true, data: project });
    }
    catch (error) {
        logger_1.default.error("[OneDrive Create Project Error]:", error.message);
        return handleCloudError(res, error);
    }
    finally {
        if (tempPath) {
            try {
                fs_1.default.unlinkSync(tempPath);
            }
            catch { /* best-effort */ }
        }
    }
});
/** GET /api/onedrive/download/:fileId — Download a file from OneDrive */
router.get("/download/:fileId", hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        const { stream, fileName, mimeType } = await onedriveService_1.OneDriveService.getFileContent(userId, req.params.fileId);
        res.setHeader("Content-Type", mimeType || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
        stream.pipe(res);
    }
    catch (error) {
        logger_1.default.error("[OneDrive Download Error]:", error.message);
        return handleCloudError(res, error);
    }
});
/** GET /api/onedrive/status — Check if OneDrive connection is still valid */
router.get("/status", hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    const userId = req.user.id;
    try {
        const result = await onedriveService_1.OneDriveService.listFiles(userId, undefined, undefined, 1);
        return res.status(200).json({ connected: true, filesCount: result.files.length });
    }
    catch (error) {
        return res.status(200).json({ connected: false, error: "Connection invalid. Please reconnect." });
    }
});
/** POST /api/onedrive/import — Import a file from OneDrive to the project library */
router.post("/import", hybridAuthMiddleware_1.authenticateHybridRequest, importLimiter, async (req, res) => {
    let tempPath = null;
    try {
        const userId = req.user.id;
        const { projectId, fileId } = req.body;
        if (!projectId || !fileId) {
            return res.status(400).json({ error: "Missing projectId or fileId" });
        }
        const { stream: odStream, fileName, mimeType } = await onedriveService_1.OneDriveService.getFileContent(userId, fileId);
        if (!fileName) {
            return res.status(400).json({ error: "Could not determine file name from OneDrive" });
        }
        const safeMimeType = mimeType || "application/octet-stream";
        ensureUploadDir();
        const tempFileName = `od-import-${Date.now()}-${fileName}`;
        tempPath = path_1.default.join(UPLOAD_DIR, tempFileName);
        await streamPipeline(odStream, fs_1.default.createWriteStream(tempPath));
        const fileSize = fs_1.default.statSync(tempPath).size;
        const storageInfo = await storageService_1.StorageService.getUserStorageInfo(userId);
        const fileSizeInMB = fileSize / (1024 * 1024);
        const newStorageUsed = storageInfo.used + fileSizeInMB;
        if (newStorageUsed > storageInfo.limit) {
            return res.status(400).json({ error: "Storage limit exceeded. Please upgrade your plan for more space." });
        }
        const readStream = fs_1.default.createReadStream(tempPath);
        const uploadResult = await supabaseStorageService_1.SupabaseStorageService.uploadFileStream(readStream, fileName, safeMimeType, userId, { userId, fileName, fileType: safeMimeType, fileSize, projectId: projectId, createdAt: new Date() });
        const fileRecord = await prisma_1.prisma.file.create({
            data: {
                user_id: userId, project_id: projectId, file_name: fileName,
                file_path: uploadResult.path, file_type: safeMimeType, file_size: fileSize,
                metadata: { source: "onedrive", originalFileId: fileId, publicUrl: uploadResult.publicUrl },
            },
        });
        await prisma_1.prisma.user.update({ where: { id: userId }, data: { storage_used: newStorageUsed } });
        logger_1.default.info("OneDrive file imported successfully", { userId, projectId, fileId: fileRecord.id, fileName, fileSize });
        return res.status(200).json({
            success: true, message: "File imported successfully",
            data: { id: fileRecord.id, fileName: fileRecord.file_name, fileType: fileRecord.file_type, fileSize: fileRecord.file_size },
        });
    }
    catch (error) {
        logger_1.default.error("[OneDrive Import Error]:", error.message);
        return handleCloudError(res, error);
    }
    finally {
        if (tempPath) {
            try {
                fs_1.default.unlinkSync(tempPath);
            }
            catch { /* best-effort */ }
        }
    }
});
/** Translate raw backend errors into user-friendly messages */
function sanitizeErrorMessage(msg) {
    // Graph API errors — strip the "OneDrive error (STATUS):" prefix
    if (msg.includes("Item does not exist") || msg.includes("itemNotFound")) {
        return "Your OneDrive folder or file was not found. It may have been moved or deleted.";
    }
    if (msg.includes("The request was aborted") || msg.includes("timeout")) {
        return "OneDrive request timed out. Please try again.";
    }
    // Return the raw message but strip the "OneDrive error (404):" prefix for cleanliness
    return msg.replace(/^OneDrive error \(\d+\):\s*/, "");
}
/** Unified cloud error handler */
function handleCloudError(res, error) {
    const msg = error.message || String(error);
    const friendly = sanitizeErrorMessage(msg);
    if (msg.includes("not connected") || msg.includes("token") || msg.includes("reconnect")) {
        return res.status(401).json({ error: friendly });
    }
    if (msg.includes("rate limit") || msg.includes("quota")) {
        return res.status(429).json({ error: friendly });
    }
    if (msg.includes("denied") || msg.includes("forbidden") || msg.includes("permission")) {
        return res.status(403).json({ error: friendly });
    }
    if (msg.includes("not found") || msg.includes("does not exist")) {
        return res.status(404).json({ error: friendly });
    }
    if (msg.includes("too large")) {
        return res.status(413).json({ error: friendly });
    }
    return res.status(500).json({ error: friendly });
}
exports.default = router;
