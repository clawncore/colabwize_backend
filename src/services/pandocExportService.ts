import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import logger from "../monitoring/logger";

const execAsync = promisify(exec);

// Dynamic Pandoc path resolution
const getPandocPath = async () => {
  // 1. Check environment variable
  if (process.env.PANDOC_PATH) return process.env.PANDOC_PATH;

  // 2. Check project-relative bin directory
  const relativePath = path.join(process.cwd(), "bin", "bin", "pandoc");
  try {
    await fs.access(relativePath);
    return relativePath;
  } catch {
    // 3. Fallback to system path
    return "pandoc";
  }
};

export interface PandocExportOptions {
  format: "pdf" | "docx" | "txt" | "latex" | "rtf" | "html";
  citationStyle?: string;
  metadata?: any;
  citations?: any[];
  htmlContent?: string;
}

export class PandocExportService {
  /**
   * Export project using Pandoc (HTML source only)
   */
  static async exportProject(
    project: any,
    options: PandocExportOptions
  ): Promise<{ buffer: Buffer; fileSize: number }> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "colabwize-export-"));
    const htmlContent = options.htmlContent || "";
    
    try {
      const extension = options.format === 'pdf' ? 'pdf' : options.format;
      const outputPath = path.join(tempDir, `output.${extension}`);

      logger.info(`[Pandoc] Exporting via HTML direct path to ${options.format}`);
      
      const htmlPath = path.join(tempDir, "input.html");
      await fs.writeFile(htmlPath, htmlContent);
      
      const pandocPath = await getPandocPath();
      
      // For PDF, we might need to specify a pdf-engine. 
      // We'll let Pandoc try its default first, but we can't use Puppeteer anymore.
      const pandocCmd = options.format === "pdf" 
        ? `"${pandocPath}" "${htmlPath}" -f html -s -o "${outputPath}"`
        : `"${pandocPath}" "${htmlPath}" -f html -s -o "${outputPath}"`;
      
      logger.info(`[Pandoc] Running command: ${pandocCmd}`);
      
      await execAsync(pandocCmd);
      const buffer = await fs.readFile(outputPath);
      return { buffer, fileSize: buffer.length };
    } catch (error: any) {
      logger.error("Pandoc export failed", { error: error.message, stack: error.stack });
      throw new Error(`Failed to export using Pandoc: ${error.message}. (Ensure a PDF engine like wkhtmltopdf or lualatex is installed for PDF export)`);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * High-fidelity PDF rendering using Puppeteer (Deprecated in favor of Pandoc)
   * Keeping as private method for now in case of quick rollback needs
   */
  private static async renderPdfViaPuppeteer(htmlContent: string): Promise<{ buffer: Buffer }> {
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${htmlContent}</body></html>`;
    const puppeteer = await import("puppeteer");
    const { ExportService } = await import("./exportService.js");
    const browser = await (ExportService as any).launchBrowser(puppeteer.default);
    
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
    } finally {
      await browser.close();
    }
  }
}
