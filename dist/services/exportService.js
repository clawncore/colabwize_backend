"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportService = void 0;
const logger_1 = __importDefault(require("../monitoring/logger"));
const pandocExportService_1 = require("./pandocExportService");
const prisma_1 = require("../lib/prisma");
class ExportService {
    /**
     * Export project in specified format (Direct HTML-to-Pandoc)
     */
    static async exportProject(projectId, // Kept for backward compatibility if needed, but primarily using options.htmlContent
    userId, options) {
        try {
            logger_1.default.info("Starting direct HTML export", {
                projectId,
                userId,
                format: options.format,
            });
            let htmlContent = options.htmlContent;
            // If htmlContent is not provided, fetch it from the database (Backward compatibility)
            if (!htmlContent && projectId) {
                const project = await prisma_1.prisma.project.findFirst({
                    where: { id: projectId, user_id: userId },
                });
                if (!project) {
                    throw new Error("Project not found or access denied");
                }
                // Handle Tiptap JSON content if stored as JSON
                const content = project.content;
                if (content && typeof content === "object") {
                    // For now, if we're in a simplified path, we might just use a placeholder
                    // or assume it's already HTML if it's a string.
                    if (content.type === "doc") {
                        const { generateHTML } = await import("@tiptap/html");
                        const { default: StarterKit } = await import("@tiptap/starter-kit");
                        // Add other extensions if needed
                        htmlContent = generateHTML(content, [StarterKit]);
                    }
                    else {
                        htmlContent = JSON.stringify(content);
                    }
                }
                else {
                    htmlContent = content?.toString() || "";
                }
            }
            if (!htmlContent) {
                throw new Error("htmlContent is required for export and could not be resolved from database");
            }
            return await pandocExportService_1.PandocExportService.exportProject({}, {
                format: options.format,
                htmlContent: htmlContent,
                metadata: options.metadata || { title: "Exported Document" }
            });
        }
        catch (error) {
            logger_1.default.error("Error in direct project export", {
                projectId,
                userId,
                format: options.format,
                error: error.message,
            });
            throw new Error(`Failed to export project: ${error.message}`);
        }
    }
    /**
     * Create a ZIP archive for user data export
     */
    static async createZipArchive(data) {
        try {
            const AdmZip = await import("adm-zip");
            const zip = new AdmZip.default();
            // Add data as a JSON file
            const content = JSON.stringify(data, null, 2);
            zip.addFile("data-export.json", Buffer.from(content, "utf8"));
            // We could add more files here if needed
            return zip.toBuffer();
        }
        catch (error) {
            logger_1.default.error("Error creating ZIP archive", { error: error.message });
            throw new Error(`Failed to create ZIP archive: ${error.message}`);
        }
    }
    /**
     * Launch Puppeteer Browser (Shared logic for PDF rendering)
     */
    static async launchBrowser(puppeteer) {
        const launchArgs = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];
        return await puppeteer.launch({
            headless: "new",
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            args: launchArgs,
        });
    }
    /**
     * Sanitize filename helper
     */
    static sanitizeFilename(filename) {
        return filename.replace(/[^a-z0-9]/gi, "_").toLowerCase();
    }
}
exports.ExportService = ExportService;
