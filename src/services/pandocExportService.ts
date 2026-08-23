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
   * Export project from HTML source. PDF is routed through Puppeteer because
   * pandoc's PDF output requires an external LaTeX/wkhtmltopdf engine that is
   * not part of the deployment image; Chromium print-to-PDF needs nothing extra.
   */
  static async exportProject(
    project: any,
    options: PandocExportOptions
  ): Promise<{ buffer: Buffer; fileSize: number }> {
    if (options.format === "pdf") {
      logger.info("[Export] Rendering PDF via Puppeteer print engine");
      const { buffer } = await this.renderPdfViaPuppeteer(options.htmlContent || "");
      return { buffer, fileSize: buffer.length };
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "colabwize-export-"));
    const htmlContent = options.htmlContent || "";

    try {
      const outputPath = path.join(tempDir, `output.${options.format}`);

      logger.info(`[Pandoc] Exporting via HTML direct path to ${options.format}`);

      const htmlPath = path.join(tempDir, "input.html");
      await fs.writeFile(htmlPath, htmlContent);

      const pandocPath = await getPandocPath();
      const pandocCmd = `"${pandocPath}" "${htmlPath}" -f html -s -o "${outputPath}"`;

      logger.info(`[Pandoc] Running command: ${pandocCmd}`);

      await execAsync(pandocCmd);
      const buffer = await fs.readFile(outputPath);
      return { buffer, fileSize: buffer.length };
    } catch (error: any) {
      logger.error("Pandoc export failed", { error: error.message, stack: error.stack });
      throw new Error(`Failed to export using Pandoc: ${error.message}`);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * High-fidelity PDF rendering using headless Chromium (print-to-PDF).
   */
  private static async renderPdfViaPuppeteer(htmlContent: string): Promise<{ buffer: Buffer }> {
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
    } finally {
      await browser.close();
    }
  }
}
