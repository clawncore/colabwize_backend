"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.POST = POST;
const client_1 = require("../../../lib/supabase/client");
const prisma_1 = require("../../../lib/prisma");
const exportService_1 = require("../../../services/exportService");
const logger_1 = __importDefault(require("../../../monitoring/logger"));
const requestHelpers_1 = require("../../../utils/requestHelpers");
// Export user data
async function POST(request) {
    try {
        // Get user from authorization header
        const authHeader = request.headers.get("authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return new Response(JSON.stringify({ error: "Missing or invalid authorization header" }), {
                status: 401,
                headers: { "Content-Type": "application/json" },
            });
        }
        const token = authHeader.substring(7); // Remove "Bearer " prefix
        let user;
        // STRATEGY: Remote Verification via Supabase Admin
        const supabase = await (0, client_1.getSupabaseClient)();
        const { data, error } = await supabase.auth.getUser(token);
        if (error || !data.user) {
            return new Response(JSON.stringify({ error: "Invalid or expired token" }), { status: 401, headers: { "Content-Type": "application/json" } });
        }
        user = data.user;
        // Parse request body
        const body = await request.json();
        const format = (0, requestHelpers_1.getSafeString)(body.format);
        const include = body.include || {};
        // Log the export request
        logger_1.default.info("User data export request received", {
            userId: user.id,
            format,
            include,
        });
        // Get user data based on include options
        const userData = {
            exportedAt: new Date().toISOString(),
        };
        if (include.projects !== false) {
            userData.projects = await prisma_1.prisma.project.findMany({
                where: { user_id: user.id },
                include: {
                    citations: true,
                    exports: true,
                    files: true,
                    originality_scans: true,
                    chat_sessions: true,
                    certificates: true,
                    analytics_events: true,
                    authorship_activities: true,
                    real_time_activities: true,
                },
            });
        }
        if (include.citations !== false) {
            userData.citations = await prisma_1.prisma.citation.findMany({
                where: { project: { user_id: user.id } },
            });
        }
        if (include.deletedItems !== false) {
            userData.deletedItems = await prisma_1.prisma.recycledItem.findMany({
                where: { user_id: user.id },
            });
        }
        // Get user profile
        userData.user = await prisma_1.prisma.user.findUnique({
            where: { id: user.id },
            select: {
                id: true,
                email: true,
                full_name: true,
                created_at: true,
                institution: true,
                location: true,
                bio: true,
            },
        });
        // Fetch user files if not explicitly excluded
        if (include.files !== false) {
            userData.files = await prisma_1.prisma.file.findMany({
                where: { user_id: user.id },
            });
        }
        // Fetch user certificates if not explicitly excluded
        if (include.certificates !== false) {
            userData.certificates = await prisma_1.prisma.certificate.findMany({
                where: { user_id: user.id },
            });
        }
        // Handle different export formats
        if (format && format !== "json") {
            // Use ExportService to handle specific format exports
            try {
                let result;
                switch (format) {
                    case "zip":
                        // Create a ZIP archive of user data
                        const zipBuffer = await exportService_1.ExportService.createZipArchive(userData);
                        return new Response(zipBuffer, {
                            // Type assertion to allow Buffer for Response
                            status: 200,
                            headers: {
                                "Content-Type": "application/zip",
                                "Content-Disposition": `attachment; filename=user-data-${user.id}.zip`,
                            },
                        });
                    default:
                        return new Response(JSON.stringify({
                            error: `Unsupported export format: ${format}`,
                        }), {
                            status: 400,
                            headers: { "Content-Type": "application/json" },
                        });
                }
            }
            catch (exportError) {
                logger_1.default.error("Error in format-specific export:", exportError);
                return new Response(JSON.stringify({
                    error: `Failed to export in ${format} format: ${exportError.message}`,
                }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                });
            }
        }
        else {
            // Default to JSON format
            return new Response(JSON.stringify({
                success: true,
                data: userData,
            }), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                },
            });
        }
    }
    catch (error) {
        console.error("Error exporting user data:", error);
        return new Response(JSON.stringify({ error: "Internal server error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
}
