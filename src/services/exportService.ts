import logger from "../monitoring/logger";
import { prisma } from "../lib/prisma";
import { SecretsService } from "./secrets-service";
import { PublicationExportService } from "./publicationExportService";
import { promises as fs } from "fs";
import path from "path";
import archiver from "archiver";
import { PassThrough } from "stream";

interface ExportOptions {
  format: "pdf" | "docx" | "txt" | "latex" | "rtf" | "zip";
  includeCitations?: boolean;
  includeComments?: boolean;
  citationStyle?: "apa" | "mla" | "chicago";
  pageSize?: "A4" | "letter";
  orientation?: "portrait" | "landscape";
  journalTemplate?: string;
  journalReady?: boolean;
  metadata?: {
    author?: string;
    institution?: string;
    course?: string;
    instructor?: string;
    runningHead?: string;
  };
}

interface ExportResult {
  buffer: Buffer;
  fileSize: number;
}

export class ExportService {
  /**
   * Export project in specified format
   */
  static async exportProject(
    projectId: string,
    userId: string,
    options: ExportOptions
  ): Promise<ExportResult> {
    try {
      logger.info("Starting project export", {
        projectId,
        userId,
        format: options.format,
      });

      // Fetch project data
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          user_id: userId,
        },
        include: {
          citations: true,
        },
      });

      if (!project) {
        throw new Error("Project not found or access denied");
      }

      let buffer: Buffer;
      let fileSize: number;

      switch (options.format) {
        case "docx":
          return await this.exportAsDOCX(projectId, userId, options);
        case "pdf":
          return await this.exportAsPDF(projectId, userId, options);
        case "txt":
          return await this.exportAsTXT(project, options);
        case "latex":
          return await this.exportAsLaTeX(project, options);
        case "rtf":
          return await this.exportAsRTF(project, options);
        case "zip":
          return await this.exportAsZip(project, options);
        default:
          throw new Error(`Unsupported export format: ${options.format}`);
      }
    } catch (error: any) {
      logger.error("Error in project export", {
        projectId,
        userId,
        format: options.format,
        error: error.message,
      });
      throw new Error(`Failed to export project: ${error.message}`);
    }
  }

  /**
   * Export as DOCX using PublicationExportService
   */
  private static async exportAsDOCX(
    projectId: string,
    userId: string,
    options: ExportOptions
  ): Promise<ExportResult> {
    const result = await PublicationExportService.exportPublicationReady(
      projectId,
      userId,
      {
        format: "docx",
        citationStyle: options.citationStyle,
        includeCoverPage: true,
        coverPageStyle: options.citationStyle === "mla" ? "mla" : "apa",
        includeTOC: true,
        performStructuralAudit: false,
        metadata: options.metadata,
      }
    );

    return {
      buffer: result.buffer,
      fileSize: result.fileSize,
    };
  }

  /**
   * Export as PDF (placeholder - in real implementation, convert DOCX to PDF)
   */
  /**
   * Export as PDF using Puppeteer
   */
  private static async exportAsPDF(
    projectId: string,
    userId: string,
    options: ExportOptions
  ): Promise<ExportResult> {
    const puppeteer = require("puppeteer");
    const { HtmlExportService } = require("./htmlExportService");

    // 1. Fetch project data (re-fetching to ensure we have it if coming from internal call)
    // Optimization: If project is already passed or available, use it. But current flow fetches in exportProject.
    const project = await prisma.project.findFirst({
      where: { id: projectId, user_id: userId },
      include: { citations: true },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    // 2. Generate HTML
    const html = await HtmlExportService.generateProjectHtml(project, {
      citationStyle: options.citationStyle,
      includeCoverPage: true, // Defaulting to true for PDF export as per general academic desires
      coverPageStyle: options.citationStyle === "mla" ? "mla" : "apa",
      metadata: options.metadata,
    });

    // 3. Render PDF via Puppeteer
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"], // Required for some containerized environments
      });
      const page = await browser.newPage();

      // Set content
      await page.setContent(html, { waitUntil: "networkidle0" });

      // Generate PDF buffer
      const buffer = await page.pdf({
        format: "Letter",
        printBackground: true,
        margin: {
          top: "1in",
          bottom: "1in",
          left: "1in",
          right: "1in",
        },
      });

      return {
        buffer: Buffer.from(buffer),
        fileSize: buffer.length,
      };
    } catch (error: any) {
      logger.error("Puppeteer PDF generation failed", { error: error.message });
      throw new Error("Failed to generate PDF: " + error.message);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Export as TXT
   */
  private static async exportAsTXT(
    project: any,
    options: ExportOptions
  ): Promise<ExportResult> {
    let content = `${project.title}\n`;
    content += `${"=".repeat(project.title.length)}\n\n`;

    // Extract text content from TipTap JSON
    if (project.content && project.content.content) {
      content += this.extractTextFromTipTap(project.content) + "\n\n";
    }

    // Add citations if requested
    if (options.includeCitations && project.citations) {
      content += "Citations:\n";
      content += "----------\n";
      project.citations.forEach((citation: any, index: number) => {
        content += `${index + 1}. ${this.formatCitation(citation, options.citationStyle || "apa")}\n`;
      });
    }

    const buffer = Buffer.from(content, "utf-8");
    return {
      buffer,
      fileSize: buffer.length,
    };
  }

  /**
   * Export as LaTeX
   */
  private static async exportAsLaTeX(
    project: any,
    options: ExportOptions
  ): Promise<ExportResult> {
    let content = "\\documentclass[12pt]{article}\n";
    content += "\\usepackage[utf8]{inputenc}\n";
    content += "\\usepackage{geometry}\n";
    content += "\\geometry{a4paper, margin=1in}\n";
    content += "\\title{" + project.title + "}\n";
    content += "\\author{}\n"; // Would get from user metadata in real implementation
    content += "\\date{\\today}\n";
    content += "\\begin{document}\n";
    content += "\\maketitle\n\n";

    // Extract content from TipTap JSON
    if (project.content && project.content.content) {
      content += this.extractLaTeXFromTipTap(project.content) + "\n\n";
    }

    // Add bibliography if citations exist
    if (
      options.includeCitations &&
      project.citations &&
      project.citations.length > 0
    ) {
      content += "\\begin{thebibliography}{9}\n";
      project.citations.forEach((citation: any, index: number) => {
        content +=
          "\\bibitem{" +
          citation.id +
          "} " +
          this.formatCitation(citation, options.citationStyle || "apa") +
          "\n";
      });
      content += "\\end{thebibliography}\n";
    }

    content += "\\end{document}";

    const buffer = Buffer.from(content, "utf-8");
    return {
      buffer,
      fileSize: buffer.length,
    };
  }

  /**
   * Export as RTF
   */
  private static async exportAsRTF(
    project: any,
    options: ExportOptions
  ): Promise<ExportResult> {
    const defaultFontSize = 24; // 12pt
    let content = "{\\rtf1\\ansi\\deff0\n";
    content += "{\\fonttbl{\\f0\\fnil\\fcharset0 Arial;}}\n";
    content += "{\\colortbl ;\\red0\\green0\\blue0;\\red0\\green0\\blue255;}\n";
    content +=
      "{\\stylesheet{\\s0\\f0\\fs24 Normal;}{\\s1\\f0\\fs32\\b Heading 1;}{\\s2\\f0\\fs28\\b Heading 2;}}\n";
    content += "\\viewkind4\\uc1\\pard\\sa200\\sl276\\slmult1\\f0\\fs24\n";

    content +=
      "{\\pard\\sa200\\sl276\\slmult1\\b\\fs36 " + project.title + "\\par}\n";

    // Extract content from TipTap JSON
    if (project.content && project.content.content) {
      content += await this.extractRTFFromTipTap(project.content);
    }

    // Add citations if requested
    if (options.includeCitations && project.citations) {
      content += "\\pard\\sa200\\sl276\\slmult1\\b\\fs28 Citations:\\par\n";
      project.citations.forEach((citation: any, index: number) => {
        content +=
          "\\pard\\sa200\\sl276\\slmult1 " +
          this.formatCitation(citation, options.citationStyle || "apa") +
          "\\par\n";
      });
    }

    content += "}";

    const buffer = Buffer.from(content, "utf-8");
    return {
      buffer,
      fileSize: buffer.length,
    };
  }

  /**
   * Extract plain text from TipTap JSON content
   */
  private static extractTextFromTipTap(content: any): string {
    if (!content || !content.content) {
      return "";
    }

    const processNode = (
      node: any,
      indentLevel: number = 0,
      listIndex?: number
    ): string => {
      let text = "";
      const indent = "  ".repeat(indentLevel);

      if (node.type === "text") {
        return node.text || "";
      }

      if (node.type === "hardBreak") {
        return "\n" + indent;
      }

      if (node.type === "paragraph" || node.type === "heading") {
        let prefix = "";
        let suffix = "\n\n";

        // Handle list item context
        if (typeof listIndex === "number") {
          // If we are in a list, the prefix is handled by the list item wrapper or processing logic
          // But usually paragraph is inside listItem.
          suffix = "\n";
        }

        if (node.content) {
          node.content.forEach((child: any) => {
            text += processNode(child, indentLevel);
          });
        }
        return prefix + indent + text + suffix;
      }

      if (node.type === "bulletList") {
        if (node.content) {
          node.content.forEach((listItem: any) => {
            text += processNode(listItem, indentLevel, -1); // -1 marks bullet
          });
        }
        return text + "\n";
      }

      if (node.type === "orderedList") {
        if (node.content) {
          let idx = 1;
          node.content.forEach((listItem: any) => {
            text += processNode(listItem, indentLevel, idx++);
          });
        }
        return text + "\n";
      }

      if (node.type === "listItem") {
        let itemText = "";
        let mark = "- ";
        if (typeof listIndex === "number" && listIndex > -1) {
          mark = `${listIndex}. `;
        }

        // List items usually contain paragraphs
        if (node.content) {
          node.content.forEach((child: any, i: number) => {
            // First child gets the bullet/number
            if (i === 0) {
              // We need to strip the initial indent from the child paragraph and apply our mark
              // This is a bit tricky with simple string concat.
              // Simplification: Just render content.
              // Inner processNode for paragraph will add indent. We want to override that for the first line?
              // Let's just manually construct:
              const childContent = processNode(child, 0); // Get raw content without indent
              itemText += childContent.trim() + "\n";
            } else {
              itemText += processNode(child, indentLevel + 1);
            }
          });
        }
        return indent + mark + itemText;
      }

      if (node.type === "blockquote") {
        if (node.content) {
          node.content.forEach((child: any) => {
            text += "> " + processNode(child, 0);
          });
        }
        return text + "\n";
      }

      if (node.type === "image") {
        return indent + `[Image: ${node.attrs?.src || ""}]\n`;
      }

      // Default recursion for other containers
      if (node.content) {
        node.content.forEach((child: any) => {
          text += processNode(child, indentLevel);
        });
      }

      return text;
    };

    let fullText = "";
    content.content.forEach((node: any) => {
      fullText += processNode(node);
    });

    return fullText.trim();
  }

  /**
   * Extract LaTeX content from TipTap JSON (Enhanced)
   */
  private static extractLaTeXFromTipTap(content: any): string {
    if (!content || !content.content) {
      return "";
    }

    let latex = "";

    // Helper to escape LaTeX special chars
    const escapeLatex = (str: string) => {
      return str
        .replace(/\\/g, "\\textbackslash ")
        .replace(/{/g, "\\{")
        .replace(/}/g, "\\}")
        .replace(/\$/g, "\\$")
        .replace(/&/g, "\\&")
        .replace(/#/g, "\\#")
        .replace(/\^/g, "\\^{}")
        .replace(/_/g, "\\_")
        .replace(/%/g, "\\%");
    };

    const processChildren = (children: any[]) => {
      let text = "";
      children.forEach((child: any) => {
        if (child.type === "text") {
          let childText = escapeLatex(child.text || "");

          if (child.marks) {
            child.marks.forEach((mark: any) => {
              if (mark.type === "bold") childText = `\\textbf{${childText}}`;
              if (mark.type === "italic") childText = `\\textit{${childText}}`;
              if (mark.type === "underline")
                childText = `\\underline{${childText}}`;
            });
          }
          text += childText;
        } else if (child.type === "hardBreak") {
          text += " \\\\ ";
        }
      });
      return text;
    };

    for (const node of content.content) {
      if (node.type === "paragraph") {
        if (node.content) {
          latex += processChildren(node.content) + "\n\n";
        }
      } else if (node.type === "heading") {
        const level = node.attrs?.level || 1;
        const headingCommands = ["section", "subsection", "subsubsection"];
        const command = headingCommands[level - 1] || "section";

        if (node.content) {
          latex +=
            "\\" + command + "{" + processChildren(node.content) + "}\n\n";
        }
      } else if (node.type === "bulletList") {
        latex += "\\begin{itemize}\n";
        if (node.content) {
          node.content.forEach((item: any) => {
            if (item.content) {
              item.content.forEach((p: any) => {
                if (p.type === "paragraph" && p.content) {
                  latex += "\\item " + processChildren(p.content) + "\n";
                }
              });
            }
          });
        }
        latex += "\\end{itemize}\n\n";
      } else if (node.type === "orderedList") {
        latex += "\\begin{enumerate}\n";
        if (node.content) {
          node.content.forEach((item: any) => {
            if (item.content) {
              item.content.forEach((p: any) => {
                if (p.type === "paragraph" && p.content) {
                  latex += "\\item " + processChildren(p.content) + "\n";
                }
              });
            }
          });
        }
        latex += "\\end{enumerate}\n\n";
      }
    }
    return latex.trim();
  }

  /**
   * Extract RTF content from TipTap JSON (Enhanced with Images & Styling)
   */
  private static async extractRTFFromTipTap(content: any): Promise<string> {
    if (!content || !content.content) {
      return "";
    }

    let rtf = "";

    // Helper to process text styling
    const processChildren = (children: any[]) => {
      let text = "";
      children.forEach((child: any) => {
        if (child.type === "text") {
          let childText = child.text || "";

          // RTF escaping
          // Escape backslashes first to avoid escaping valid escapes
          childText = childText.replace(/\\/g, "\\\\");
          // Escape braces
          childText = childText.replace(/\{/g, "\\{").replace(/\}/g, "\\}");
          // Convert special chars to unicode entities or similar if needed,
          // but for basic RTF on simple chars, standard text is usually fine.
          // For fancy quotes etc, replace with ascii equivalents or \\u codes
          childText = childText
            .replace(/’/g, "'")
            .replace(/“/g, '"')
            .replace(/”/g, '"')
            .replace(/–/g, "-")
            .replace(/—/g, "--");

          // Handle newlines within text node (if any remaining)
          childText = childText.replace(/\n/g, "\\line ");

          if (child.marks) {
            let prefix = "";
            let suffix = "";
            child.marks.forEach((mark: any) => {
              if (mark.type === "bold") {
                prefix += "\\b ";
                suffix = "\\b0 " + suffix;
              }
              if (mark.type === "italic") {
                prefix += "\\i ";
                suffix = "\\i0 " + suffix;
              }
              if (mark.type === "underline") {
                prefix += "\\ul ";
                suffix = "\\ulnone " + suffix;
              }
              if (mark.type === "code") {
                prefix += "\\f1 "; // Assuming f1 would be monospace if defined, fallback to nothing
                suffix = "\\f0 " + suffix;
              }
            });
            childText = prefix + childText + suffix;
          }
          text += childText;
        } else if (child.type === "hardBreak") {
          text += "\\line ";
        }
      });
      return text;
    };

    // Helper to fetch image and convert to hex
    const processImage = async (src: string): Promise<string> => {
      try {
        let imageUrl = src;
        if (src.startsWith("/")) {
          // Internal URL - prepend app URL
          const appUrl = await SecretsService.getAppUrl();
          imageUrl = `${appUrl}${src}`;
        }

        // Don't try to fetch data URIs
        if (src.startsWith("data:")) {
          // Basic support for base64 data URIs
          const base64Data = src.split(",")[1];
          if (base64Data) {
            const buffer = Buffer.from(base64Data, "base64");
            return `{\\pict\\pngblip\\picwgoal${600 * 15}\\pichgoal${400 * 15} ${buffer.toString("hex")} }`;
          }
          return "";
        }

        const fetch = (await import("node-fetch")).default;
        const response = await fetch(imageUrl);
        if (!response.ok) return "";

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const hex = buffer.toString("hex");

        // RTF image wrapper (assuming PNG/JPEG treated as pngblip or jpegblip)
        // \pngblip for PNG, \jpegblip for JPEG.
        // We'll simplisticly use pngblip which often works for modern readers or check extension
        let blipType = "\\pngblip";
        if (
          src.toLowerCase().endsWith(".jpg") ||
          src.toLowerCase().endsWith(".jpeg")
        ) {
          blipType = "\\jpegblip";
        }

        // Approx width/height goals (twips). 1 pixel approx 15 twips
        // Setting a reasonable default width
        const widthTwips = 600 * 15;
        const heightTwips = 400 * 15;

        return `{\\pard\\qc {\\pict${blipType}\\picwgoal${widthTwips}\\pichgoal${heightTwips} ${hex} }\\par}`;
      } catch (e) {
        console.error("RTF Image processing failed", e);
        return "";
      }
    };

    for (const node of content.content) {
      if (node.type === "paragraph") {
        if (node.content) {
          rtf +=
            "{\\pard\\sa200\\sl276\\slmult1 " +
            processChildren(node.content) +
            "\\par}\n";
        } else {
          rtf += "{\\pard\\sa200\\sl276\\slmult1 \\par}\n"; // Empty paragraph
        }
      } else if (node.type === "heading") {
        const level = node.attrs?.level || 1;
        // Calculation: 24 (12pt) base. H1=32 (16pt), H2=28 (14pt)
        // Half-points: 16pt = 32, 14pt = 28.
        const fs = 24 + (3 - level) * 4;
        const fontSize = fs > 24 ? fs : 24;

        rtf += `{\\pard\\sa200\\sb200\\sl276\\slmult1\\b\\fs${fontSize} `;
        if (node.content) {
          rtf += processChildren(node.content);
        }
        rtf += "\\par}\n";
      } else if (node.type === "image") {
        if (node.attrs?.src) {
          const imageRtf = await processImage(node.attrs.src);
          rtf += imageRtf + "\n";
        }
      } else if (node.type === "bulletList") {
        if (node.content) {
          node.content.forEach((item: any) => {
            if (item.content) {
              item.content.forEach((p: any) => {
                if (p.type === "paragraph" && p.content) {
                  // Use standardized bullet points with proper indentation
                  rtf +=
                    "{\\pard\\sa100\\sl276\\slmult1\\li500\\fi-200 \\bullet\\tab " +
                    processChildren(p.content) +
                    "\\par}\n";
                }
              });
            }
          });
        }
      } else if (node.type === "orderedList") {
        let i = 1;
        if (node.content) {
          node.content.forEach((item: any) => {
            if (item.content) {
              item.content.forEach((p: any) => {
                if (p.type === "paragraph" && p.content) {
                  // Use numbered list
                  rtf +=
                    "{\\pard\\sa100\\sl276\\slmult1\\li500\\fi-200 " +
                    i++ +
                    ".\\tab " +
                    processChildren(p.content) +
                    "\\par}\n";
                }
              });
            }
          });
        }
      } else if (node.type === "blockquote") {
        rtf += "{\\pard\\sa200\\sl276\\slmult1\\li500\\ri500\\i ";
        if (node.content) {
          // Iterate blockquote content (usually paragraphs)
          for (const child of node.content) {
            if (child.type === "paragraph" && child.content) {
              rtf += processChildren(child.content) + "\\line ";
            }
          }
        }
        rtf += "\\par}\n";
      }
    }
    return rtf;
  }

  private static async exportAsZip(
    project: any,
    options: ExportOptions
  ): Promise<ExportResult> {
    const archive = archiver("zip", {
      zlib: { level: 9 }, // Sets the compression level.
    });

    const stream = new PassThrough();
    const buffers: Buffer[] = [];

    stream.on("data", (data) => buffers.push(data));

    return new Promise(async (resolve, reject) => {
      stream.on("end", () => {
        const buffer = Buffer.concat(buffers);
        resolve({
          buffer,
          fileSize: buffer.length,
        });
      });

      archive.on("error", (err) => reject(err));

      archive.pipe(stream);

      // Add project metadata/content JSON
      archive.append(JSON.stringify(project, null, 2), {
        name: "project_data.json",
      });

      // Try to add a text version as well
      try {
        const txtResult = await this.exportAsTXT(project, options);
        archive.append(txtResult.buffer, {
          name: `${this.sanitizeFilename(project.title || "project")}.txt`,
        });
      } catch (error) {
        logger.warn("Failed to generate text version for zip export", {
          projectId: project.id,
        });
      }

      await archive.finalize();
    });
  }

  /**
   * Create a ZIP archive for full user data export
   */
  public static async createZipArchive(userData: any): Promise<Buffer> {
    const archive = archiver("zip", {
      zlib: { level: 9 },
    });

    const stream = new PassThrough();
    const buffers: Buffer[] = [];

    stream.on("data", (data) => buffers.push(data));

    const finalBufferPromise = new Promise<Buffer>((resolve, reject) => {
      stream.on("end", () => {
        resolve(Buffer.concat(buffers));
      });
      stream.on("error", reject);
      archive.on("error", reject);
    });

    archive.pipe(stream);

    // 1. User Profile
    if (userData.user) {
      archive.append(JSON.stringify(userData.user, null, 2), {
        name: "profile.json",
      });
    }

    // 2. Projects
    if (userData.projects && Array.isArray(userData.projects)) {
      userData.projects.forEach((project: any) => {
        const safeTitle = this.sanitizeFilename(project.title || "untitled");
        const filename = `projects/${safeTitle}_${project.id}.json`;
        archive.append(JSON.stringify(project, null, 2), { name: filename });
      });
    }

    // 3. Citations
    if (userData.citations && Array.isArray(userData.citations)) {
      archive.append(JSON.stringify(userData.citations, null, 2), {
        name: "citations.json",
      });
    }

    // 4. Activity History
    if (userData.activityHistory && Array.isArray(userData.activityHistory)) {
      archive.append(JSON.stringify(userData.activityHistory, null, 2), {
        name: "activity_history.json",
      });
    }

    // 5. Comments
    if (userData.comments && Array.isArray(userData.comments)) {
      archive.append(JSON.stringify(userData.comments, null, 2), {
        name: "comments.json",
      });
    }

    // 6. Deleted Items
    if (userData.deletedItems && Array.isArray(userData.deletedItems)) {
      archive.append(JSON.stringify(userData.deletedItems, null, 2), {
        name: "trash.json",
      });
    }

    // 7. Documents (Files)
    if (userData.files && Array.isArray(userData.files)) {
      for (const file of userData.files) {
        try {
          // Check if file exists
          if (file.file_path) {
            const fileContent = await fs.readFile(file.file_path);
            const safeFileName = this.sanitizeFilename(
              file.file_name || "document"
            );
            const ext =
              path.extname(file.file_path) ||
              path.extname(file.file_name) ||
              "";

            archive.append(fileContent, {
              name: `documents/${safeFileName}${ext}`,
            });
          }
        } catch (error) {
          logger.warn(`Failed to add file to export zip: ${file.id}`, error);
        }
      }
    }

    // 8. Certificates
    if (userData.certificates && Array.isArray(userData.certificates)) {
      for (const cert of userData.certificates) {
        try {
          if (cert.file_path) {
            const certContent = await fs.readFile(cert.file_path);
            const safeCertName = this.sanitizeFilename(
              cert.title || cert.file_name || "certificate"
            );
            const ext = path.extname(cert.file_path) || ".pdf";

            archive.append(certContent, {
              name: `certificates/${safeCertName}${ext}`,
            });
          }
        } catch (error) {
          logger.warn(
            `Failed to add certificate to export zip: ${cert.id}`,
            error
          );
        }
      }
    }

    // Add metadata about the export
    archive.append(
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          version: "1.0",
          stats: {
            projects: userData.projects?.length || 0,
            citations: userData.citations?.length || 0,
            files: userData.files?.length || 0,
            certificates: userData.certificates?.length || 0,
          },
        },
        null,
        2
      ),
      { name: "export_metadata.json" }
    );

    await archive.finalize();

    return finalBufferPromise;
  }

  private static sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-z0-9]/gi, "_").toLowerCase();
  }

  /**
   * Format citation in specified style
   */
  private static formatCitation(citation: any, style: string): string {
    const authors = citation.author || citation.authors || "Unknown";
    const title = citation.title || "Untitled";
    const year = citation.year || "n.d.";
    const journal = citation.journal || "";
    const volume = citation.volume || "";
    const issue = citation.issue || "";
    const pages = citation.pages || "";

    if (style === "apa") {
      let formatted = `${authors} (${year}). `;
      formatted += `${title}.`;
      if (journal) {
        formatted += ` ${journal}`;
        if (volume) formatted += `, ${volume}`;
        if (issue) formatted += `(${issue})`;
        if (pages) formatted += `, ${pages}`;
      }
      return formatted;
    } else if (style === "mla") {
      let formatted = `${authors}. "${title}." `;
      if (journal) {
        formatted += `${journal}`;
        if (volume) formatted += `, vol. ${volume}`;
        if (issue) formatted += `, no. ${issue}`;
        if (pages) formatted += `, pp. ${pages}`;
      }
      formatted += ` ${year}.`;
      return formatted;
    } else {
      // Chicago style
      let formatted = `${authors}. "${title}." `;
      if (journal) {
        formatted += `${journal} `;
        if (volume) formatted += `${volume}, no. ${issue} `;
        if (pages) formatted += `(${year}): ${pages}.`;
      } else {
        formatted += `(${year}).`;
      }
      return formatted;
    }
  }
}
