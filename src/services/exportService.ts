import logger from "../monitoring/logger";
import { PandocExportService } from "./pandocExportService";
import { prisma } from "../lib/prisma";

interface ExportOptions {
  format: "pdf" | "docx" | "txt" | "latex" | "rtf";
  htmlContent?: string;
  metadata?: any;
  includeCitations?: boolean;
  includeComments?: boolean;
  citationStyle?: "apa" | "mla" | "chicago" | "ieee" | "harvard" | string;
  journalTemplate?: string;
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

      let htmlContent = options.htmlContent;

      // If htmlContent is not provided, fetch it from the database (Backward compatibility)
      if (!htmlContent && projectId) {
        const project = await prisma.project.findFirst({
          where: { id: projectId, user_id: userId },
        });
        
        if (!project) {
          throw new Error("Project not found or access denied");
        }
        
        // Handle Tiptap JSON content if stored as JSON
        const content = project.content as any;
        if (content && typeof content === "object") {
          // For now, if we're in a simplified path, we might just use a placeholder
          // or assume it's already HTML if it's a string.
          if (content.type === "doc") {
            const { generateHTML } = await import("@tiptap/html");
            const { default: StarterKit } = await import("@tiptap/starter-kit");
            // Add other extensions if needed
            htmlContent = generateHTML(content, [StarterKit]);
          } else {
            htmlContent = JSON.stringify(content);
          }
        } else {
          htmlContent = content?.toString() || "";
        }
      }

      if (!htmlContent) {
        throw new Error("htmlContent is required for export and could not be resolved from database");
      }

      return await PandocExportService.exportProject({}, {
        format: options.format,
        htmlContent: htmlContent,
        metadata: options.metadata || { title: "Exported Document" }
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
   * Create a ZIP archive for user data export
   */
  static async createZipArchive(data: any): Promise<Buffer> {
    try {
      const AdmZip = await import("adm-zip");
      const zip = new AdmZip.default();
      
      // Add data as a JSON file
      const content = JSON.stringify(data, null, 2);
      zip.addFile("data-export.json", Buffer.from(content, "utf8"));
      
      // We could add more files here if needed
      
      return zip.toBuffer();
    } catch (error: any) {
      logger.error("Error creating ZIP archive", { error: error.message });
      throw new Error(`Failed to create ZIP archive: ${error.message}`);
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
