"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../../middleware/auth");
const documentUploadService_1 = require("../../services/documentUploadService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const router = (0, express_1.Router)();
// Get all projects for a user (with optional workspace filtering)
router.get("/", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        const workspaceId = req.query.workspaceId;
        const fetchArchived = req.query.archived === "true";
        let projects;
        if (workspaceId === "null") {
            // Personal projects only (no workspace)
            projects = await documentUploadService_1.DocumentUploadService.getUserProjects(userId, {
                personalOnly: true,
                fetchArchived,
            });
        }
        else if (workspaceId) {
            // Projects in a specific workspace
            projects = await documentUploadService_1.DocumentUploadService.getUserProjects(userId, {
                workspaceId,
                fetchArchived,
            });
        }
        else {
            // All projects (default, backward compatible)
            projects = await documentUploadService_1.DocumentUploadService.getUserProjects(userId, {
                fetchArchived,
            });
        }
        res.status(200).json({
            success: true,
            data: projects,
        });
    }
    catch (error) {
        logger_1.default.error("Error fetching user projects", {
            error: error.message,
            stack: error.stack,
        });
        // Graceful degradation: Return 200 with status "unavailable"
        res.status(200).json({
            success: false,
            status: "unavailable",
            data: [],
            message: "Service temporarily unavailable. Please try again later.",
        });
    }
});
// Export a project (Common GET for direct download)
router.get("/export", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { projectId, format, includeCitations, includeComments, citationStyle, template, } = req.query;
        const userId = req.user.id;
        if (!projectId) {
            return res.status(400).json({ error: "Project ID is required" });
        }
        const { ExportService } = await import("../../services/exportService.js");
        if (format === "docx" || format === "word") {
            res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            res.setHeader("Content-Disposition", `attachment; filename="export-${projectId}.docx"`);
        }
        else if (format === "pdf") {
            res.setHeader("Content-Type", "application/pdf");
            res.setHeader("Content-Disposition", `attachment; filename="export-${projectId}.pdf"`);
        }
        else {
            return res.status(400).json({ error: "Invalid format specified" });
        }
        const exportResult = await ExportService.exportProject(projectId, userId, {
            format: format,
            includeCitations: includeCitations === "true",
            includeComments: includeComments === "true",
            citationStyle: citationStyle,
            journalTemplate: template,
        });
        return res.send(exportResult.buffer);
    }
    catch (error) {
        logger_1.default.error("Error exporting project", {
            error: error.message,
            stack: error.stack,
            projectId: req.query.projectId,
        });
        return res
            .status(500)
            .json({ error: "Failed to export project: " + error.message });
    }
});
// Cloud Export: Google Drive
router.post("/export/google-drive", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { projectId, format = "pdf", htmlContent, metadata } = req.body;
        const userId = req.user.id;
        if (!projectId || !htmlContent) {
            return res
                .status(400)
                .json({ error: "Missing projectId or htmlContent" });
        }
        const { ExportService } = await import("../../services/exportService.js");
        const { GoogleDriveService } = await import("../../services/googleDriveService.js");
        // 1. Generate the file buffer
        const exportResult = await ExportService.exportProject(projectId, userId, {
            format: format,
            htmlContent,
            metadata,
        });
        // 2. Upload to Google Drive
        const fileName = `${metadata?.title || "Exported Document"}.${format}`;
        const mimeType = format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const gDriveResult = await GoogleDriveService.uploadFile(userId, fileName, exportResult.buffer, mimeType);
        return res.status(200).json({
            success: true,
            message: "Project successfully exported to Google Drive",
            url: gDriveResult.webViewLink,
            data: gDriveResult,
        });
    }
    catch (error) {
        logger_1.default.error("Error exporting to Google Drive", {
            error: error.message,
            userId: req.user?.id,
        });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Cloud Export: OneDrive
router.post("/export/onedrive", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { projectId, format = "pdf", htmlContent, metadata } = req.body;
        const userId = req.user.id;
        if (!projectId || !htmlContent) {
            return res
                .status(400)
                .json({ error: "Missing projectId or htmlContent" });
        }
        const { ExportService } = await import("../../services/exportService.js");
        const { OneDriveService } = await import("../../services/onedriveService.js");
        const { Readable } = await import("stream");
        // 1. Generate the file buffer
        const exportResult = await ExportService.exportProject(projectId, userId, {
            format: format,
            htmlContent,
            metadata,
        });
        // 2. Upload to OneDrive
        const fileName = `${metadata?.title || "Exported Document"}.${format}`;
        const mimeType = format === "pdf"
            ? "application/pdf"
            : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const odResult = await OneDriveService.uploadFile(userId, fileName, Readable.from(exportResult.buffer), mimeType);
        return res.status(200).json({
            success: true,
            message: "Project successfully exported to OneDrive",
            url: odResult.webUrl || null,
            data: odResult,
        });
    }
    catch (error) {
        logger_1.default.error("Error exporting to OneDrive", {
            error: error.message,
            userId: req.user?.id,
        });
        return res
            .status(500)
            .json({ success: false, message: error.message });
    }
});
// Cloud Export: Zotero
router.post("/export/zotero", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { projectId, metadata } = req.body;
        const userId = req.user.id;
        const { ZoteroService } = await import("../../services/zoteroService.js");
        const { prisma } = await import("../../lib/prisma.js");
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { zotero_api_key: true, zotero_user_id: true },
        });
        if (!user?.zotero_api_key || !user?.zotero_user_id) {
            return res.status(401).json({ error: "Zotero account not linked" });
        }
        // Prepare Zotero item (Metadata Only as requested)
        const itemData = {
            itemType: "journalArticle",
            title: metadata?.title || "Untitled Paper",
            creators: (metadata?.author || "")
                .split(",")
                .map((name) => ({
                creatorType: "author",
                name: name.trim(),
            }))
                .filter((c) => c.name),
            abstractNote: metadata?.abstract || "",
            date: metadata?.date || new Date().toISOString(),
            libraryCatalog: "ColabWize",
            url: `${process.env.FRONTEND_URL || "http://localhost:3000"}/dashboard/editor/${projectId}`,
        };
        const result = await ZoteroService.createItem(user.zotero_user_id, user.zotero_api_key, itemData);
        return res.status(200).json({
            success: true,
            message: "Metadata successfully exported to Zotero",
            data: result,
        });
    }
    catch (error) {
        logger_1.default.error("Error exporting to Zotero", {
            error: error.message,
            userId: req.user?.id,
        });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Cloud Export: Mendeley
router.post("/export/mendeley", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { projectId, metadata } = req.body;
        const userId = req.user.id;
        const { MendeleyService } = await import("../../services/mendeleyService.js");
        // Prepare Mendeley item (Metadata Only as requested)
        const itemData = {
            type: "journal",
            title: metadata?.title || "Untitled Paper",
            authors: (metadata?.author || "").split(",").map((name) => {
                const parts = name.trim().split(" ");
                return {
                    first_name: parts[0] || "",
                    last_name: parts.slice(1).join(" ") || "Author",
                };
            }),
            abstract: metadata?.abstract || "",
            year: metadata?.date
                ? new Date(metadata.date).getFullYear()
                : new Date().getFullYear(),
            websites: [
                `${process.env.FRONTEND_URL || "http://localhost:3000"}/dashboard/editor/${projectId}`,
            ],
        };
        const result = await MendeleyService.createDocument(userId, itemData);
        return res.status(200).json({
            success: true,
            message: "Metadata successfully exported to Mendeley",
            data: result,
        });
    }
    catch (error) {
        logger_1.default.error("Error exporting to Mendeley", {
            error: error.message,
            userId: req.user?.id,
        });
        return res.status(500).json({ success: false, message: error.message });
    }
});
// Get a specific project
router.get("/:projectId", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user.id;
        const project = await documentUploadService_1.DocumentUploadService.getProjectById(projectId, userId);
        if (!project) {
            return res.status(404).json({
                success: false,
                error: "Project not found",
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
            data: null,
            message: "Service temporarily unavailable. Please try again later.",
        });
    }
});
// Update a project
router.put("/:projectId", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { projectId } = req.params;
        const { title, description, content, citation_style } = req.body;
        const userId = req.user.id;
        // Validate required fields
        if (!title) {
            return res.status(400).json({ error: "Title is required" });
        }
        // Update project
        const updatedProject = await documentUploadService_1.DocumentUploadService.updateProject(projectId, userId, title, description || "", content, content ? JSON.stringify(content).length : 0, citation_style);
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
// Delete a project
router.delete("/:projectId", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const { projectId } = req.params;
        const userId = req.user.id;
        // Delete project
        const deletedProject = await documentUploadService_1.DocumentUploadService.deleteProject(projectId, userId);
        return res.status(200).json({
            success: true,
            data: deletedProject,
            message: "Project deleted successfully",
        });
    }
    catch (error) {
        logger_1.default.error("Error deleting project", {
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
exports.default = router;
