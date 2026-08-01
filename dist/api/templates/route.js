"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
exports.POST = POST;
exports.PUT = PUT;
exports.DELETE = DELETE;
const prisma_1 = require("../../lib/prisma");
const logger_1 = __importDefault(require("../../monitoring/logger"));
async function GET(request) {
    try {
        const url = new URL(request.url, "http://localhost");
        const type = url.pathname.split("/").pop(); // Get the type from the URL path like /api/templates/type/research-paper
        const userId = url.searchParams.get("userId");
        const workspaceId = url.searchParams.get("workspaceId");
        const isPublic = url.searchParams.get("isPublic");
        let whereClause = {};
        // If a type is provided, filter by type
        if (type && type !== "type" && type !== "templates") {
            whereClause.type = type;
        }
        // Filter by workspace if provided (this takes precedence over user/public usually)
        if (workspaceId) {
            whereClause.workspace_id = workspaceId;
        }
        // If not a workspace template, handle user/public logic
        else if (userId) {
            whereClause.user_id = userId;
            whereClause.workspace_id = null; // Ensure we don't get workspace templates mixed in
        }
        else if (isPublic !== "false") {
            // Default to public templates
            whereClause.is_public = true;
            whereClause.workspace_id = null; // Public templates are usually system templates
        }
        const templates = await prisma_1.prisma.documentTemplate.findMany({
            where: whereClause,
            select: {
                id: true,
                name: true,
                description: true,
                type: true,
                content: true,
                citation_style: true,
                is_public: true,
                created_at: true,
                updated_at: true,
                rating: true,
                downloads: true,
                author_name: true,
                workspace_id: true,
            },
        });
        return new Response(JSON.stringify({ success: true, templates }), {
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error fetching templates:", error);
        return new Response(JSON.stringify({ success: false, message: "Failed to fetch templates" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
async function POST(request) {
    try {
        const data = (await request.json());
        const { name, description, type, content, is_public, user_id, workspace_id, citation_style, } = data;
        const template = await prisma_1.prisma.documentTemplate.create({
            data: {
                name,
                description: description || null,
                type,
                content,
                is_public: is_public || false,
                user_id: user_id || null,
                workspace_id: workspace_id || null,
                citation_style: citation_style || null,
            },
        });
        return new Response(JSON.stringify({ success: true, template }), {
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error creating template:", error);
        return new Response(JSON.stringify({ success: false, message: "Failed to create template" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
async function PUT(request) {
    try {
        const data = (await request.json());
        const { id, name, description, type, content, is_public, citation_style } = data;
        const template = await prisma_1.prisma.documentTemplate.update({
            where: { id },
            data: {
                name,
                description: description || null,
                type,
                content,
                is_public,
                citation_style: citation_style || null,
                workspace_id: data.workspace_id,
                updated_at: new Date(),
            },
        });
        return new Response(JSON.stringify({ success: true, template }), {
            headers: { "Content-Type": "application/json" },
        });
    }
    catch (error) {
        logger_1.default.error("Error updating template:", error);
        return new Response(JSON.stringify({ success: false, message: "Failed to update template" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
async function DELETE(request) {
    try {
        const url = new URL(request.url, "http://localhost");
        const id = url.searchParams.get("id");
        if (!id) {
            return new Response(JSON.stringify({
                success: false,
                message: "Template ID is required",
            }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        await prisma_1.prisma.documentTemplate.delete({
            where: { id },
        });
        return new Response(JSON.stringify({
            success: true,
            message: "Template deleted successfully",
        }), { headers: { "Content-Type": "application/json" } });
    }
    catch (error) {
        logger_1.default.error("Error deleting template:", error);
        return new Response(JSON.stringify({ success: false, message: "Failed to delete template" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
}
