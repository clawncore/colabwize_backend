"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PandocExportService = void 0;
const child_process_1 = require("child_process");
const util_1 = require("util");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const logger_1 = __importDefault(require("../monitoring/logger"));
const execAsync = (0, util_1.promisify)(child_process_1.exec);
// Dynamic Pandoc path resolution
const getPandocPath = async () => {
    // 1. Check environment variable
    if (process.env.PANDOC_PATH)
        return process.env.PANDOC_PATH;
    // 2. Check project-relative bin directory
    const relativePath = path_1.default.join(process.cwd(), "bin", "bin", "pandoc");
    try {
        await promises_1.default.access(relativePath);
        return relativePath;
    }
    catch {
        // 3. Fallback to system path
        return "pandoc";
    }
};
class PandocExportService {
    /**
     * Export project using Pandoc (HTML source only)
     */
    static async exportProject(project, options) {
        const tempDir = await promises_1.default.mkdtemp(path_1.default.join(os_1.default.tmpdir(), "colabwize-export-"));
        const htmlContent = options.htmlContent || "";
        try {
            const extension = options.format === 'pdf' ? 'pdf' : options.format;
            const outputPath = path_1.default.join(tempDir, `output.${extension}`);
            logger_1.default.info(`[Pandoc] Exporting via HTML direct path to ${options.format}`);
            const htmlPath = path_1.default.join(tempDir, "input.html");
            await promises_1.default.writeFile(htmlPath, htmlContent);
            const pandocPath = await getPandocPath();
            // For PDF, we might need to specify a pdf-engine.
            // We'll let Pandoc try its default first, but we can't use Puppeteer anymore.
            const pandocCmd = options.format === "pdf"
                ? `"${pandocPath}" "${htmlPath}" -f html -s -o "${outputPath}"`
                : `"${pandocPath}" "${htmlPath}" -f html -s -o "${outputPath}"`;
            logger_1.default.info(`[Pandoc] Running command: ${pandocCmd}`);
            await execAsync(pandocCmd);
            const buffer = await promises_1.default.readFile(outputPath);
            return { buffer, fileSize: buffer.length };
        }
        catch (error) {
            logger_1.default.error("Pandoc export failed", { error: error.message, stack: error.stack });
            throw new Error(`Failed to export using Pandoc: ${error.message}. (Ensure a PDF engine like wkhtmltopdf or lualatex is installed for PDF export)`);
        }
        finally {
            await promises_1.default.rm(tempDir, { recursive: true, force: true });
        }
    }
    /**
     * High-fidelity PDF rendering using Puppeteer (Deprecated in favor of Pandoc)
     * Keeping as private method for now in case of quick rollback needs
     */
    static async renderPdfViaPuppeteer(htmlContent) {
        const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${htmlContent}</body></html>`;
        const puppeteer = await import("puppeteer");
        const { ExportService } = await import("./exportService.js");
        const browser = await ExportService.launchBrowser(puppeteer.default);
        try {
            const page = await browser.newPage();
            await page.emulateMediaType("print");
            await page.setContent(fullHtml, { waitUntil: "networkidle0" });
            const buffer = await page.pdf({
                format: "A4",
                printBackground: true,
                margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" }
            });
            return { buffer: Buffer.from(buffer) };
        }
        finally {
            await browser.close();
        }
    }
}
exports.PandocExportService = PandocExportService;
