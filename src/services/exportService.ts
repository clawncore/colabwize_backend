import logger from "../monitoring/logger";
import { PandocExportService } from "./pandocExportService";

interface ExportOptions {
  format: "pdf" | "docx" | "txt" | "latex" | "rtf";
  htmlContent?: string;
  metadata?: any;
}

interface ExportResult {
  buffer: Buffer;
  fileSize: number;
}

export class ExportService {
  /**
   * Export project in specified format (Direct HTML-to-Pandoc)
   */
  static async exportProject(
    projectId: string, // Kept for backward compatibility if needed, but primarily using options.htmlContent
    userId: string,
    options: ExportOptions,
  ): Promise<ExportResult> {
    try {
      logger.info("Starting direct HTML export", {
        projectId,
        userId,
        format: options.format,
      });

      if (!options.htmlContent) {
        throw new Error("htmlContent is required for simplified export");
      }

      return await PandocExportService.exportProject({}, {
        format: options.format,
        htmlContent: options.htmlContent,
        metadata: options.metadata
      });
    } catch (error: any) {
      logger.error("Error in direct project export", {
        projectId,
        userId,
        format: options.format,
        error: error.message,
      });
      throw new Error(`Failed to export project: ${error.message}`);
    }
  }

  /**
   * Launch Puppeteer Browser (Shared logic for PDF rendering)
   */
  public static async launchBrowser(puppeteer: any) {
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
  public static sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  }
}
