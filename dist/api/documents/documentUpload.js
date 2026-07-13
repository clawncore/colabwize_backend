"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const auth_1 = require("../../middleware/auth");
const documentUploadService_1 = require("../../services/documentUploadService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = (0, express_1.Router)();
// Configure multer for file uploads
const storage = multer_1.default.diskStorage({
    destination: (req, file, cb) => {
        // Create uploads directory if it doesn't exist
        const uploadDir = path_1.default.join(__dirname, "../../../../uploads");
        if (!fs_1.default.existsSync(uploadDir)) {
            fs_1.default.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        // Generate unique filename
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
        // Allowed extensions
        const allowedExtensions = [".pdf", ".docx", ".txt", ".rtf", ".odt"];
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        // Check MIME type or extension
        // We prioritize extension check because some browsers/OSs/Postman might send generic MIME types
        if (allowedExtensions.includes(ext)) {
            return cb(null, true);
        }
        // Also allow by mimetype just in case
        const allowedMimeTypes = [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // docx
            "text/plain", // txt
            "application/rtf",
            "text/rtf", // rtf
            "application/vnd.oasis.opendocument.text", // odt
            "application/octet-stream", // fallback
        ];
        if (allowedMimeTypes.includes(file.mimetype)) {
            return cb(null, true);
        }
        console.log("File upload rejected:", {
            originalname: file.originalname,
            mimetype: file.mimetype,
            ext,
            allowedMimeTypes,
            allowedExtensions,
        });
        cb(new Error("Error: Invalid file type! Only PDF, DOCX, TXT, RTF, and ODT files are allowed."));
    },
});
// Create a new project with document upload
router.post("/", auth_1.authenticateExpressRequest, upload.single("document"), async (req, res) => {
    try {
        const { title, description, workspaceId, workspace_id, linked_library } = req.body;
        const userId = req.user.id; // authenticated user ID
        // Validate required fields
        if (!title) {
            return res.status(400).json({ error: "Title is required" });
        }
        if (!req.file) {
            return res.status(400).json({ error: "Document file is required" });
        }
        // Create project with uploaded document
        const project = await documentUploadService_1.DocumentUploadService.createProjectWithDocument(userId, title, description || "", req.file, workspaceId || workspace_id, linked_library);
        return res.status(201).json({
            success: true,
            data: project,
        });
    }
    catch (error) {
        logger_1.default.error("Error creating project with document", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(200).json({
            success: false,
            status: "unavailable",
            message: "Service temporarily unavailable. Please try again later.",
        });
    }
});
// Get user's projects
router.get("/", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        const projects = await documentUploadService_1.DocumentUploadService.getUserProjects(userId, {
            personalOnly: true,
        });
        return res.status(200).json({
            success: true,
            data: projects,
        });
    }
    catch (error) {
        logger_1.default.error("Error fetching user projects", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(200).json({
            success: false,
            status: "unavailable",
            data: [],
            message: "Service temporarily unavailable. Please try again later.",
        });
    }
});
// Get a specific project
router.get("/:projectId", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user.id;
        logger_1.default.info(`[DEBUG] GET /api/documents/${projectId} - User: ${userId}`, {
            projectId,
            userId,
        });
        const project = await documentUploadService_1.DocumentUploadService.getProjectById(projectId, userId);
        if (!project) {
            // DEBUG: Check if project exists at all
            const projectCheck = await documentUploadService_1.DocumentUploadService.checkProjectExists(projectId);
            if (projectCheck) {
                logger_1.default.warn(`[DEBUG] Access denied for project ${projectId}. Owner: ${projectCheck.user_id}, Requesting User: ${userId}`, {
                    projectId,
                    ownerId: projectCheck.user_id,
                    requestingUserId: userId,
                });
                return res.status(404).json({
                    success: false,
                    error: "Project found but access denied (Owner mismatch)",
                    debug: {
                        ownerId: projectCheck.user_id,
                        requestingUserId: userId,
                        projectTitle: projectCheck.title,
                    },
                });
            }
            logger_1.default.info(`[DEBUG] Project truly not found: ${projectId}`, {
                projectId,
                userId,
            });
            return res.status(404).json({
                success: false,
                error: "Project ID not found in database",
            });
        }
        return res.status(200).json({
            success: true,
            data: project,
        });
    }
    catch (error) {
        logger_1.default.error("Error fetching project", {
            error: error.message,
            stack: error.stack,
            projectId: req.params.projectId,
        });
        return res.status(200).json({
            success: false,
            status: "unavailable",
            message: "Service temporarily unavailable. Please try again later.",
        });
    }
});
// Update a specific project
router.put("/:projectId", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { title, description, content, word_count, citation_style, status, outline, } = req.body;
        const userId = req.user.id;
        // Validate required fields
        if (!title) {
            return res.status(400).json({ error: "Title is required" });
        }
        // Update project
        const updatedProject = await documentUploadService_1.DocumentUploadService.updateProject(projectId, userId, title, description || "", content, word_count || 0, citation_style, outline, status ? { status } : undefined);
        if (!updatedProject) {
            return res.status(404).json({
                success: false,
                error: "Project not found",
            });
        }
        return res.status(200).json({
            success: true,
            data: updatedProject,
        });
    }
    catch (error) {
        logger_1.default.error("Error updating project", {
            error: error.message,
            stack: error.stack,
            projectId: req.params.projectId,
        });
        return res.status(200).json({
            success: false,
            status: "unavailable",
            message: "Service temporarily unavailable. Please try again later.",
        });
    }
});
// Create a new project without document upload
router.post("/create", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { title, description, content, workspace_id, linked_library } = req.body;
        const userId = req.user.id;
        logger_1.default.info(`[DEBUG] POST /api/documents/create - User: ${userId}, Title: ${title}, Workspace: ${workspace_id || "personal"}`, { userId, title, workspace_id });
        // Validate required fields
        if (!title) {
            return res.status(400).json({ error: "Title is required" });
        }
        // Create project with provided content or empty content
        const project = await documentUploadService_1.DocumentUploadService.createProject(userId, title, description || "", content || null, null, // outline
        workspace_id || undefined, linked_library);
        return res.status(201).json({
            success: true,
            data: project,
        });
    }
    catch (error) {
        logger_1.default.error("Error creating project", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(200).json({
            success: false,
            status: "unavailable",
            message: "Service temporarily unavailable. Please try again later.",
        });
    }
});
exports.default = router;
