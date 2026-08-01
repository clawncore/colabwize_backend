"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST_VERSION = POST_VERSION;
exports.GET_VERSIONS = GET_VERSIONS;
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const hybridAuth_1 = require("../../middleware/hybridAuth");
const editorService_1 = require("../../services/editorService");
// Create a new document version (separate from save operations)
async function POST_VERSION(request) {
    // Wrap with hybrid authentication
    return (0, hybridAuth_1.withHybridAuth)(handlePOST_VERSION)(request);
}
async function handlePOST_VERSION(request) {
    try {
        const body = (await request.json());
        const { projectId, content, wordCount, force } = body;
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
        // Check if we should create a new version based on our dual-threshold approach
        // OR if this is a forced version creation (manual save)
        const versionResult = await prisma_1.prisma.$transaction(async (tx) => {
            // If force is true, skip the threshold check
            const shouldCreate = force
                ? true
                : await editorService_1.EditorService.shouldCreateNewVersion(projectId, tx, wordCount, content);
            if (!shouldCreate) {
                return { shouldCreate: false, version: null };
            }
            // Create a new document version separately from save operations
            const version = await editorService_1.EditorService.createDocumentVersion(projectId, userId, content, wordCount || 0, tx // Pass the transaction
            );
            return { shouldCreate: true, version };
        }, { timeout: 30000 });
        if (!versionResult.shouldCreate) {
            // Return success but indicate no new version was created
            return new Response(JSON.stringify({
                success: true,
                message: "No new version created - thresholds not met",
                version: null,
            }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            });
        }
        return new Response(JSON.stringify({
            success: true,
            version: versionResult.version,
        }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error creating document version:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
// Get document versions with enhanced information
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
