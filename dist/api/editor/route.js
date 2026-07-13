"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.PUT = PUT;
exports.PATCH_METADATA = PATCH_METADATA;
exports.GET_VERSIONS = GET_VERSIONS;
exports.POST_COMMENT = POST_COMMENT;
exports.GET_COMMENTS = GET_COMMENTS;
exports.POST_RESTORE_VERSION = POST_RESTORE_VERSION;
exports.DELETE_VERSION = DELETE_VERSION;
exports.GET_SETTINGS = GET_SETTINGS;
exports.PUT_SETTINGS = PUT_SETTINGS;
exports.GET_ANALYTICS = GET_ANALYTICS;
exports.POST_BEACON_DRAFT = POST_BEACON_DRAFT;
exports.POST_IMPORT = POST_IMPORT;
exports.POST_EVENTS = POST_EVENTS;
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const hybridAuth_1 = require("../../middleware/hybridAuth");
const editorService_1 = require("../../services/editorService");
const auth_helpers_1 = require("../../lib/auth-helpers");
// Get project content
async function GET(request) {
    // Wrap with hybrid authentication
    return (0, hybridAuth_1.withHybridAuth)(handleGET)(request);
}
async function handleGET(request) {
    try {
        const { searchParams } = new URL(request.url, "http://localhost");
        const projectId = searchParams.get("projectId");
        if (!projectId) {
            return new Response(JSON.stringify({ error: "Project ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Use authenticated user ID
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const project = await editorService_1.EditorService.getProjectContent(projectId, userId);
        return new Response(JSON.stringify({
            success: true,
            project: project,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error fetching project content:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Save project content
async function PUT(request) {
    // Wrap with hybrid authentication (requires write permission for API keys)
    return (0, hybridAuth_1.withHybridAuth)(handlePUT)(request);
}
async function handlePUT(request) {
    try {
        const body = (await request.json());
        const { projectId, content, title, wordCount } = body;
        if (!projectId) {
            return new Response(JSON.stringify({ error: "Project ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Use authenticated user ID
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const updatedProject = await editorService_1.EditorService.saveProjectContent(projectId, userId, content, title, wordCount);
        // Track editor activity
        await editorService_1.EditorService.trackEditorActivity(userId, projectId, "edit", {});
        return new Response(JSON.stringify({
            success: true,
            project: updatedProject,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error saving project content:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Phase 2: Update project metadata only (when Hocuspocus handles content)
async function PATCH_METADATA(request) {
    return (0, hybridAuth_1.withHybridAuth)(handlePATCH_METADATA)(request);
}
async function handlePATCH_METADATA(request) {
    try {
        const body = (await request.json());
        const { projectId, ...metadata } = body;
        if (!projectId) {
            return new Response(JSON.stringify({ error: "Project ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const updatedProject = await editorService_1.EditorService.updateProjectMetadata(projectId, userId, metadata);
        return new Response(JSON.stringify({
            success: true,
            project: updatedProject,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error updating project metadata:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Get document versions/history
async function GET_VERSIONS(request) {
    // Wrap with hybrid authentication
    return (0, hybridAuth_1.withHybridAuth)(handleGET_VERSIONS)(request);
}
async function handleGET_VERSIONS(request) {
    try {
        const { searchParams } = new URL(request.url, "http://localhost");
        const projectId = searchParams.get("projectId");
        if (!projectId) {
            return new Response(JSON.stringify({ error: "Project ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Use authenticated user ID
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Verify user has access to project
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
        if (!hasAccess) {
            return new Response(JSON.stringify({ error: "Project not found or access denied" }), { status: 404, headers: { "Content-Type": "application/json" } });
        }
        const versions = await editorService_1.EditorService.getDocumentVersions(projectId, userId);
        return new Response(JSON.stringify({
            success: true,
            versions: versions,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error fetching document versions:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Add comment to document
async function POST_COMMENT(request) {
    // Wrap with hybrid authentication (requires write permission for API keys)
    return (0, hybridAuth_1.withHybridAuth)(handlePOST_COMMENT)(request);
}
async function handlePOST_COMMENT(request) {
    try {
        const body = (await request.json());
        const { projectId, content, position } = body;
        if (!projectId || !content) {
            return new Response(JSON.stringify({ error: "Project ID and content are required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Use authenticated user ID
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const comment = await editorService_1.EditorService.addComment(projectId, userId, content, position);
        // Track editor activity
        await editorService_1.EditorService.trackEditorActivity(userId, projectId, "comment", {});
        return new Response(JSON.stringify({
            success: true,
            comment: comment,
        }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error adding comment:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Get comments for document
async function GET_COMMENTS(request) {
    // Wrap with hybrid authentication
    return (0, hybridAuth_1.withHybridAuth)(handleGET_COMMENTS)(request);
}
async function handleGET_COMMENTS(request) {
    try {
        const { searchParams } = new URL(request.url, "http://localhost");
        const projectId = searchParams.get("projectId");
        if (!projectId) {
            return new Response(JSON.stringify({ error: "Project ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Use authenticated user ID
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const comments = await editorService_1.EditorService.getComments(projectId, userId);
        return new Response(JSON.stringify({
            success: true,
            comments: comments,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error fetching comments:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Restore document version
async function POST_RESTORE_VERSION(request) {
    // Wrap with hybrid authentication (requires write permission for API keys)
    return (0, hybridAuth_1.withHybridAuth)(handlePOST_RESTORE_VERSION)(request);
}
async function handlePOST_RESTORE_VERSION(request) {
    try {
        const body = (await request.json());
        const { projectId, versionId } = body;
        if (!projectId || !versionId) {
            return new Response(JSON.stringify({ error: "Project ID and Version ID are required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Use authenticated user ID
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const restoredProject = await editorService_1.EditorService.restoreDocumentVersion(projectId, versionId, userId);
        return new Response(JSON.stringify({
            success: true,
            project: restoredProject,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error restoring document version:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Delete a specific document version
async function DELETE_VERSION(request) {
    return (0, hybridAuth_1.withHybridAuth)(handleDELETE_VERSION)(request);
}
async function handleDELETE_VERSION(request) {
    try {
        const body = (await request.json());
        const { projectId, versionId } = body;
        if (!projectId || !versionId) {
            return new Response(JSON.stringify({ error: "Project ID and Version ID are required" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Verify the project belongs to this user or user has access
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
        if (!hasAccess) {
            return new Response(JSON.stringify({ error: "Project not found or access denied" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Find the version and check it's not the latest
        const version = await prisma_1.prisma.documentVersion.findUnique({
            where: { id: versionId },
            select: { id: true, project_id: true },
        });
        if (!version || version.project_id !== projectId) {
            return new Response(JSON.stringify({ error: "Version not found" }), {
                status: 404,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Prevent deleting the most recent version (current)
        const latestVersion = await prisma_1.prisma.documentVersion.findFirst({
            where: { project_id: projectId },
            orderBy: { created_at: "desc" },
            select: { id: true },
        });
        if (latestVersion?.id === versionId) {
            return new Response(JSON.stringify({ error: "Cannot delete the current version" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        await prisma_1.prisma.documentVersion.delete({ where: { id: versionId } });
        return new Response(JSON.stringify({ success: true, message: "Version deleted" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    catch (error) {
        logger_1.default.error("Error deleting document version:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Get editor settings
async function GET_SETTINGS(request) {
    // Wrap with hybrid authentication
    return (0, hybridAuth_1.withHybridAuth)(handleGET_SETTINGS)(request);
}
async function handleGET_SETTINGS(request) {
    try {
        // Use authenticated user ID
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const settings = await editorService_1.EditorService.getEditorSettings(userId);
        return new Response(JSON.stringify({
            success: true,
            settings: settings,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error fetching editor settings:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Update editor settings
async function PUT_SETTINGS(request) {
    // Wrap with hybrid authentication (requires write permission for API keys)
    return (0, hybridAuth_1.withHybridAuth)(handlePUT_SETTINGS)(request);
}
async function handlePUT_SETTINGS(request) {
    try {
        const body = (await request.json());
        // Use authenticated user ID
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const settings = await editorService_1.EditorService.updateEditorSettings(userId, body);
        return new Response(JSON.stringify({
            success: true,
            settings: settings,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error updating editor settings:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Get editor analytics
async function GET_ANALYTICS(request) {
    // Wrap with hybrid authentication
    return (0, hybridAuth_1.withHybridAuth)(handleGET_ANALYTICS)(request);
}
async function handleGET_ANALYTICS(request) {
    try {
        // Use authenticated user ID
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const analytics = await editorService_1.EditorService.getEditorActivity(userId);
        return new Response(JSON.stringify({
            success: true,
            analytics: analytics,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error fetching editor analytics:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Handle beacon draft requests
async function POST_BEACON_DRAFT(request) {
    // Wrap with hybrid authentication (requires write permission for API keys)
    return (0, hybridAuth_1.withHybridAuth)(handlePOST_BEACON_DRAFT)(request);
}
async function handlePOST_BEACON_DRAFT(request) {
    try {
        const body = (await request.json());
        const { id, title, contentHash, savedAt } = body;
        if (!id) {
            return new Response(JSON.stringify({ error: "Project ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Use authenticated user ID
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Log the beacon receipt for analytics/debugging
        logger_1.default.info("Received draft beacon", {
            projectId: id,
            userId,
            title,
            contentHash,
            savedAt,
        });
        // For now, we just acknowledge receipt
        // In a full implementation, we might store this info for recovery purposes
        return new Response(JSON.stringify({
            success: true,
            message: "Draft beacon received",
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error handling draft beacon:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Import document
async function POST_IMPORT(request) {
    // Wrap with hybrid authentication (requires write permission for API keys)
    return (0, hybridAuth_1.withHybridAuth)(handlePOST_IMPORT)(request);
}
async function handlePOST_IMPORT(request) {
    try {
        const body = (await request.json());
        const { fileData } = body;
        if (!fileData) {
            return new Response(JSON.stringify({ error: "File data is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Use authenticated user ID
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Validate file type
        const validTypes = [
            "text/plain",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/pdf",
        ];
        if (!validTypes.includes(fileData.fileType)) {
            return new Response(JSON.stringify({ error: "Invalid file type" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        const importedProject = await editorService_1.EditorService.importDocument(userId, fileData);
        return new Response(JSON.stringify({
            success: true,
            project: importedProject,
        }), {
            status: 201,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error importing document:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Handle editor analytics events
async function POST_EVENTS(request) {
    // Wrap with hybrid authentication (requires write permission for API keys)
    return (0, hybridAuth_1.withHybridAuth)(handlePOST_EVENTS)(request);
}
async function handlePOST_EVENTS(request) {
    try {
        const body = (await request.json());
        const { events } = body;
        if (!events || !Array.isArray(events)) {
            return new Response(JSON.stringify({ error: "Events array is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Use authenticated user ID
        const userId = request.user?.id;
        if (!userId) {
            return new Response(JSON.stringify({ error: "User ID is required" }), {
                status: 400,
                headers: { "Content-Type": "application/json" },
            });
        }
        // Process editor events
        for (const event of events) {
            try {
                // Validate event structure
                if (!event.eventType || !event.projectId) {
                    logger_1.default.warn("Skipping invalid editor event", { event });
                    continue;
                }
                // Track the event using EditorService
                await editorService_1.EditorService.trackEditorEvent(userId, event.projectId, event.eventType, event.metadata);
            }
            catch (eventError) {
                logger_1.default.error("Error processing editor event", {
                    error: eventError,
                    event,
                });
                // Continue processing other events even if one fails
            }
        }
        return new Response(JSON.stringify({
            success: true,
            message: `Processed ${events.length} events`,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error handling editor events:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
