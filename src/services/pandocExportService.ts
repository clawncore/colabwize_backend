import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import logger from "../monitoring/logger";

const execAsync = promisify(exec);
const PANDOC_PATH = "/home/clawncore/Desktop/colabwize/backend/bin/bin/pandoc";

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
      const outputPath = path.join(tempDir, `output.${options.format === 'pdf' ? 'pdf' : options.format}`);

      logger.info(`[Pandoc] Exporting via HTML direct path to ${options.format}`);
      
      if (options.format === "pdf") {
        const { buffer } = await this.renderPdfViaPuppeteer(htmlContent);
        return { buffer, fileSize: buffer.length };
      }

      const htmlPath = path.join(tempDir, "input.html");
      await fs.writeFile(htmlPath, htmlContent);
      
      // Standard direct HTML to DOCX command using Pandoc standalone mode
      const pandocCmd = `"${PANDOC_PATH}" "${htmlPath}" -f html -s -o "${outputPath}"`;
      
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
   * High-fidelity PDF rendering using Puppeteer
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
