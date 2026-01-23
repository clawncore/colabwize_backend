import logger from "../monitoring/logger";
import { prisma } from "../lib/prisma";
import { SecretsService } from "./secrets-service";
import {
  Document,
  Paragraph,
  Packer,
  HeadingLevel,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  VerticalAlign,
  AlignmentType,
  BorderStyle,
  TableOfContents,
  StyleLevel,
} from "docx";
import { PublicationService } from "./publicationService";

interface PublicationExportOptions {
  format: "pdf" | "docx";
  citationStyle?: "apa" | "mla" | "chicago";
  includeCoverPage: boolean;
  coverPageStyle: "apa" | "mla";
  template?: string; // e.g., "ieee", "acm"
  includeTOC: boolean;
  includeAuthorshipCertificate?: boolean;
  performStructuralAudit: boolean;
  minWordCount?: number;
  metadata?: {
    author?: string;
    institution?: string;
    course?: string;
    instructor?: string;
    runningHead?: string;
  };
}

interface PublicationResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  fileSize: number;
  auditResults?: {
    isValid: boolean;
    issues: string[];
    warnings: string[];
  };
}

export class PublicationExportService {
  /**
   * Export project as publication-ready document with cover page, TOC, and structural audit
   * This is the MVP "One-Click Publication Suite" feature
   */
  static async exportPublicationReady(
    projectId: string,
    userId: string,
    options: PublicationExportOptions
  ): Promise<PublicationResult> {
    try {
      logger.info("Starting publication-ready export", {
        projectId,
        userId,
        includeCoverPage: options.includeCoverPage,
        includeTOC: options.includeTOC,
      });

      // 1. Fetch project data
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

      // 2. Perform structural audit if requested
      let auditResults;
      if (options.performStructuralAudit) {
        auditResults = PublicationService.performStructuralAudit(
          project.content,
          project.title,
          project.word_count,
          options.minWordCount || 0
        );

        if (!auditResults.isValid) {
          logger.warn("Structural audit found issues", {
            projectId,
            issues: auditResults.issues,
          });
          // Continue with export but include audit results
        }

        if (auditResults.warnings.length > 0) {
          logger.info("Structural audit warnings", {
            projectId,
            warnings: auditResults.warnings,
          });
        }
      }

      // 3. Get user metadata for cover page
      const userMetadata = await PublicationService.getUserMetadata(userId);

      // 4. Generate document components
      let coverPageParagraphs: Paragraph[] | undefined;
      if (options.includeCoverPage) {
        const metadata = {
          title: project.title,
          author: options.metadata?.author || userMetadata.author,
          institution: options.metadata?.institution,
          course: options.metadata?.course,
          instructor: options.metadata?.instructor,
          runningHead: options.metadata?.runningHead,
        };

        coverPageParagraphs =
          options.coverPageStyle === "apa"
            ? PublicationService.generateAPACoverPage(metadata)
            : PublicationService.generateMLACoverPage(metadata);

        logger.debug("Generated cover page", {
          style: options.coverPageStyle,
          metadata,
        });
      }

      // 5. Native TOC Generation
      let tocParagraphs: (Paragraph | TableOfContents)[] | undefined;
      if (options.includeTOC) {
        // Using Native Word TOC instead of manual paragraphs
        // This allows Word to handle page numbers and updates
        tocParagraphs = [
          new Paragraph({
            text: "Table of Contents",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
          }),
          new TableOfContents("Summary", {
            hyperlink: true,
            headingStyleRange: "1-3",
          }),
          new Paragraph({
            text: "",
            pageBreakBefore: true,
          }),
        ];
      }

      // 6. Convert body content to paragraphs
      const bodyParagraphs = await this.convertTipTapToDOCXParagraphs(
        project.content
      );

      // 7b. Generate Authorship Certificate
      if (options.includeAuthorshipCertificate) {
        try {
          const { AuthorshipCertificateGenerator } = require("./authorshipCertificateGenerator");
          const { AuthorshipReportService } = require("./authorshipReportService");
          const { config } = require("../config/env");

          const userMetadata = await PublicationService.getUserMetadata(userId);
          const userName = options.metadata?.author || userMetadata.author || "Author";

          const stats = await AuthorshipReportService.getAuthorshipMetrics(project.id);
          const verificationUrl = `${config.appUrl}/verify/${project.id}`;

          const qrCodeDataUrl = await AuthorshipCertificateGenerator.generateQRCodeDataURL(verificationUrl);

          const certHtml = await AuthorshipCertificateGenerator.generateCertificateHTML(
            {
              projectId: project.id,
              userId: userId,
              userName: userName,
              projectTitle: project.title,
              certificateType: "authorship",
              includeQRCode: true,
              verificationUrl: verificationUrl
            },
            stats,
            qrCodeDataUrl
          );

          const imageBuffer = await AuthorshipCertificateGenerator.generatePreviewImage(certHtml);

          // Add page break and image
          bodyParagraphs.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: imageBuffer,
                  transformation: {
                    width: 600, // Full width (approx)
                    height: 450, // Aspect ratio
                  },
                  type: "png"
                }),
              ],
              pageBreakBefore: true,
            })
          );

        } catch (error) {
          logger.error("Failed to append authorship certificate to DOCX", error);
        }
      }

      // 8. Generate references section (renumbered from 7 to match flow, but references usually last? 
      // Actually certificate should be VERY LAST or before references? 
      // User likely wants it as an addendum.
      // Let's keep references as is, and we appended to bodyParagraphs which come BEFORE references in mergeDocumentComponents?
      // Wait, mergeDocumentComponents puts body then references.

      // If I want certificate AFTER references, I should add it to a new list or append to referencesParagraphs.
      // Let's append to referencesParagraphs if they exist, or create a new component.

      // Better: Create `certificateParagraphs` and pass to mergeDocumentComponents.
      // But mergeDocumentComponents signature is fixed in PublicationService?
      // Let's check PublicationService.mergeDocumentComponents (it's imported).
      // If I can't change it easily, I'll append to referencesParagraphs.

      const certificateParagraphs: Paragraph[] = [];
      if (options.includeAuthorshipCertificate) {
        // Re-implement logic here to populate certificateParagraphs instead of bodyParagraphs
        try {
          const { AuthorshipCertificateGenerator } = require("./authorshipCertificateGenerator");
          const { AuthorshipReportService } = require("./authorshipReportService");
          const { config } = require("../config/env");

          const userMetadata = await PublicationService.getUserMetadata(userId);
          const userName = options.metadata?.author || userMetadata.author || "Author";

          const stats = await AuthorshipReportService.getAuthorshipMetrics(project.id);
          const verificationUrl = `${config.appUrl}/verify/${project.id}`;
          const qrCodeDataUrl = await AuthorshipCertificateGenerator.generateQRCodeDataURL(verificationUrl);

          const certHtml = await AuthorshipCertificateGenerator.generateCertificateHTML(
            {
              projectId: project.id,
              userId: userId,
              userName: userName,
              projectTitle: project.title,
              certificateType: "authorship",
              includeQRCode: true,
              verificationUrl: verificationUrl
            },
            stats,
            qrCodeDataUrl
          );

          const imageBuffer = await AuthorshipCertificateGenerator.generatePreviewImage(certHtml);

          certificateParagraphs.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: imageBuffer,
                  transformation: {
                    width: 700,
                    height: 500,
                  },
                  type: "png"
                }),
              ],
              pageBreakBefore: true,
            })
          );
        } catch (e) { logger.error("Cert generation failed", e); }
      }

      // 7. Generate references section (original 7)
      const referencesParagraphs: Paragraph[] = [];
      if (project.citations && project.citations.length > 0) {
        referencesParagraphs.push(
          new Paragraph({
            text: "References",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 400, after: 200 },
            pageBreakBefore: true, // References usually start on new page
          })
        );
        // ... existing citation loop ...
        // Re-inserting the loop logic below because I am replacing the block
        project.citations.forEach((citation: any, index: number) => {
          referencesParagraphs.push(
            new Paragraph({
              text: `${index + 1}. ${this.formatCitation(citation, options.citationStyle || "apa")}`,
              spacing: { after: 100 },
            })
          );
        });
      }

      // Append certificate paragraphs to references/body if needed
      // Since mergeDocumentComponents takes specific named args, and I can't see its source but I see usage:
      // { coverPage, toc, body, references }
      // I will append certificateParagraphs to referencesParagraphs (if any) or bodyParagraphs (if no references).

      if (certificateParagraphs.length > 0) {
        if (referencesParagraphs.length > 0) {
          referencesParagraphs.push(...certificateParagraphs);
        } else {
          bodyParagraphs.push(...certificateParagraphs);
        }
      }

      // 8. Merge all components
      const allParagraphs = PublicationService.mergeDocumentComponents({
        coverPage: coverPageParagraphs,
        toc: tocParagraphs,
        body: bodyParagraphs,
        references:
          referencesParagraphs.length > 0 ? referencesParagraphs : undefined,
      });

      // 9. Create DOCX document with Template-Aware Styles
      const isIEEE = options.template?.toLowerCase().includes("ieee");
      const baseFont = isIEEE ? "Times New Roman" : "Calibri";
      const baseSize = isIEEE ? 20 : 24; // 10pt vs 12pt

      const defaultStyles = {
        paragraphStyles: [
          {
            id: "Normal",
            name: "Normal",
            run: {
              size: baseSize,
              font: baseFont,
            },
            paragraph: {
              spacing: { line: 360, after: 100 },
              alignment: isIEEE ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
            },
          },
          {
            id: "Heading1",
            name: "Heading 1",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: isIEEE ? 24 : 32, // 12pt vs 16pt
              bold: true,
              font: baseFont,
              color: "000000",
              allCaps: isIEEE, // IEEE often uses all caps for H1
            },
            paragraph: {
              spacing: { before: 240, after: 120 },
              alignment: isIEEE ? AlignmentType.CENTER : AlignmentType.LEFT,
            },
          },
          {
            id: "Heading2",
            name: "Heading 2",
            basedOn: "Normal",
            next: "Normal",
            quickFormat: true,
            run: {
              size: isIEEE ? 20 : 28, // 10pt vs 14pt
              bold: true,
              font: baseFont,
              color: "000000",
              italics: isIEEE, // IEEE H2 often italics
            },
            paragraph: {
              spacing: { before: 240, after: 120 },
              alignment: AlignmentType.LEFT,
            },
          },
          {
            id: "Caption",
            name: "Caption",
            basedOn: "Normal",
            next: "Normal",
            run: {
              italics: true,
              size: baseSize - 4, // Smaller caption
              color: "404040",
              font: baseFont,
            },
            paragraph: {
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
            },
          },
        ],
      };

      const doc = new Document({
        styles: defaultStyles,
        features: {
          updateFields: true, // Forces TOC update on open
        },
        sections: [
          {
            properties: {},
            children: allParagraphs,
          },
        ],
      });

      // 10. Generate buffer
      const buffer = await Packer.toBuffer(doc);
      const filename = `${project.title.replace(/\s+/g, "_")}_publication.docx`;

      logger.info("Publication-ready export complete", {
        projectId,
        fileSize: buffer.length,
        includedCoverPage: !!coverPageParagraphs,
        includedTOC: !!tocParagraphs,
        citationCount: project.citations?.length || 0,
        auditValid: auditResults?.isValid,
      });

      return {
        buffer,
        filename,
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileSize: buffer.length,
        auditResults: auditResults
          ? {
            isValid: auditResults.isValid,
            issues: auditResults.issues,
            warnings: auditResults.warnings,
          }
          : undefined,
      };
    } catch (error: any) {
      logger.error("Error in publication-ready export", {
        projectId,
        userId,
        error: error.message,
      });
      throw new Error(
        `Failed to export publication-ready document: ${error.message}`
      );
    }
  }

  /**
   * Convert TipTap JSON to DOCX Paragraphs (enhanced version)
   */
  private static async convertTipTapToDOCXParagraphs(
    content: any
  ): Promise<(Paragraph | Table)[]> {
    const paragraphs: (Paragraph | Table)[] = [];

    if (!content || !content.content) {
      return paragraphs;
    }

    // DEBUG: Dump content to file for analysis
    try {
      const fs = require("fs");
      const path = require("path");
      // Use a temp path or specific known path if possible, falling back to cwd
      const debugPath = path.join(process.cwd(), "debug_export.json");
      fs.writeFileSync(debugPath, JSON.stringify(content, null, 2));

      // Also write to a public spot if possible or log the content snippet
      // logger.info("Debug Content Snippet:", JSON.stringify(content).substring(0, 500));
    } catch (err) {
      logger.warn("Failed to dump debug export", err);
    }

    for (const node of content.content) {
      if (node.type === "paragraph") {
        const children = this.extractTextRunsFromNode(node);
        paragraphs.push(
          new Paragraph({
            children: children,
            spacing: { line: 360, after: 140 }, // 1.5 line spacing + 7pt after
          })
        );
      } else if (node.type === "heading") {
        const children = this.extractTextRunsFromNode(node);
        const level = node.attrs?.level || 1;
        // Map number to HeadingLevel enum
        const headingLevels: Record<number, any> = {
          1: HeadingLevel.HEADING_1,
          2: HeadingLevel.HEADING_2,
          3: HeadingLevel.HEADING_3,
          4: HeadingLevel.HEADING_4,
          5: HeadingLevel.HEADING_5,
          6: HeadingLevel.HEADING_6,
        };
        paragraphs.push(
          new Paragraph({
            children: children,
            heading: headingLevels[level] || HeadingLevel.HEADING_1,
            spacing: { before: 240, after: 200 }, // Add spacing before/after headings
          })
        );
      } else if (node.type === "bulletList" || node.type === "orderedList") {
        if (node.content) {
          for (const listItem of node.content) {
            if (listItem.content) {
              for (const childNode of listItem.content) {
                // Simplification: Assume list items contain paragraphs
                if (childNode.type === "paragraph") {
                  const children = this.extractTextRunsFromNode(childNode);
                  paragraphs.push(
                    new Paragraph({
                      children: children,
                      bullet: { level: 0 }, // Simple bullet level
                      spacing: { line: 360 },
                    })
                  );
                }
              }
            }
          }
        }
      } else if ((node.type === "image" || node.type === "imageExtension") && node.attrs?.src) {
        try {
          const src = node.attrs.src;

          // Skip Blob URLs - they cannot be resolved server-side
          if (src.startsWith("blob:")) {
            logger.warn("Skipping blob URL in export", { src });
            continue; // Skip this node
          }

          logger.debug("Processing image for DOCX export", { src });

          let data: Buffer | undefined;

          if (src.startsWith("data:")) {
            const matches = src.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
              const base64Data = matches[2];
              data = Buffer.from(base64Data, "base64");
            }
          } else if (src.startsWith("http")) {
            try {
              // Add header to avoid basic blocking or request JSON if API
              const response = await fetch(src, {
                headers: { 'User-Agent': 'ColabWize-Export-Service' }
              });

              if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                data = Buffer.from(arrayBuffer);
              } else {
                logger.warn("Failed to fetch image", { status: response.status, src });
              }
            } catch (e) {
              logger.warn("Fetch failed", { error: e });
            }
          } else {
            // Handle relative URLs
            const appUrl = await SecretsService.getAppUrl();
            const fullUrl = src.startsWith("/")
              ? `${appUrl}${src}`
              : `${appUrl}/${src}`;

            try {
              const response = await fetch(fullUrl);
              if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                data = Buffer.from(arrayBuffer);
              }
            } catch (err) {
              logger.warn("Error fetching relative image URL", { error: err, fullUrl });
            }
          }

          if (data && data.length > 100) {
            // --- MAGIC BYTE VALIDATION ---
            // Prevent embedding HTML (like 404 pages) or text as images, which crashes Word
            let detectedType: "png" | "jpeg" | "gif" | "bmp" | "svg" | null = null;

            // Check for PNG: 89 50 4E 47
            if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
              detectedType = "png";
            }
            // Check for JPEG: FF D8 FF
            else if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
              detectedType = "jpeg";
            }
            // Check for GIF: 47 49 46 38
            else if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
              detectedType = "gif";
            }
            // Check for BMP: 42 4D
            else if (data[0] === 0x42 && data[1] === 0x4D) {
              detectedType = "bmp";
            }
            // Check for simple SVG by starting tag (not perfect but catches most text-based SVGs)
            // <svg (3c 73 76 67)
            else if (data.toString('utf8').trim().startsWith('<svg')) {
              detectedType = "svg";
            }

            if (!detectedType || detectedType === "svg") {
              logger.warn("Invalid or unsupported image data detected (unknown signature or SVG), skipping to prevent corruption.", {
                firstBytes: data.subarray(0, 8).toString('hex'),
                detected: detectedType
              });
              continue;
            }

            // Respect user dimensions if available
            const widthAttr = node.attrs.width;
            const heightAttr = node.attrs.height;

            const parseDim = (val: any) => {
              const parsed = parseInt(String(val).replace("px", ""), 10);
              return isNaN(parsed) || parsed <= 0 ? null : parsed;
            };

            const userWidth = parseDim(widthAttr);
            const userHeight = parseDim(heightAttr);

            const transformation: any = {
              width: userWidth || 400,
              height: userHeight || 300,
            };

            paragraphs.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: data,
                    transformation: transformation,
                    type: detectedType as any,
                    altText: node.attrs.alt || "Image", // Preserve alt text info
                  }),
                ],
                spacing: { before: 240, after: 240 },
                alignment:
                  node.attrs.align === "center"
                    ? AlignmentType.CENTER
                    : node.attrs.align === "right"
                      ? AlignmentType.RIGHT
                      : AlignmentType.LEFT,
              })
            );
          }
        } catch (e: any) {
          logger.warn("Failed to process image for DOCX export", { error: e.message });
        }
      } else if (node.type === "columns" || node.type === "columnLayout") {
        // Handle multi-column layout
        const numColumns = parseInt(node.attrs?.columns || "2", 10);

        if (node.content && node.content.length > 0) {
          const tableRows: TableRow[] = [];
          const isNestedStructure = node.content.some((c: any) => c.type === "column");

          if (isNestedStructure) {
            // Old nested logic
            const columnCells = [];
            for (const column of node.content) {
              if (column.type === "column") {
                const columnParagraphs = await this.convertTipTapToDOCXParagraphs(column);
                columnCells.push(
                  new TableCell({
                    children: columnParagraphs.length > 0 ? columnParagraphs : [new Paragraph({ text: "" })],
                    borders: { top: { style: "none" }, bottom: { style: "none" }, left: { style: "none" }, right: { style: "none" } },
                    width: { size: Math.floor(5000 / numColumns), type: WidthType.PERCENTAGE },
                    verticalAlign: VerticalAlign.TOP,
                  })
                );
              }
            }
            if (columnCells.length > 0) {
              tableRows.push(new TableRow({ children: columnCells }));
            }
          } else {
            // Flat Grid Logic
            const items = node.content;
            const colWidth = Math.floor(5000 / numColumns);
            let currentRowCells: TableCell[] = [];

            for (let i = 0; i < items.length; i++) {
              const item = items[i];
              const cellParagraphs = await this.convertTipTapToDOCXParagraphs({ content: [item] });

              currentRowCells.push(
                new TableCell({
                  children: cellParagraphs.length > 0 ? cellParagraphs : [new Paragraph({ text: "" })],
                  borders: { top: { style: "none" }, bottom: { style: "none" }, left: { style: "none" }, right: { style: "none" } },
                  width: { size: colWidth, type: WidthType.PERCENTAGE },
                  verticalAlign: VerticalAlign.TOP,
                })
              );

              if (currentRowCells.length === numColumns) {
                tableRows.push(new TableRow({ children: currentRowCells }));
                currentRowCells = [];
              }
            }

            if (currentRowCells.length > 0) {
              while (currentRowCells.length < numColumns) {
                currentRowCells.push(
                  new TableCell({
                    children: [new Paragraph({ text: "" })],
                    borders: { top: { style: "none" }, bottom: { style: "none" }, left: { style: "none" }, right: { style: "none" } },
                    width: { size: colWidth, type: WidthType.PERCENTAGE },
                  })
                );
              }
              tableRows.push(new TableRow({ children: currentRowCells }));
            }
          }

          if (tableRows.length > 0) {
            paragraphs.push(
              new Table({
                rows: tableRows,
                width: { size: 5000, type: WidthType.PERCENTAGE },
                borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
              })
            );
          }
        }
      } else if (node.type === "table") {
        // Handle table
        const tableRows = [];
        if (node.content) {
          for (const row of node.content) {
            if (row.type === "tableRow") {
              const cells = [];
              if (row.content) {
                const colCount = row.content.length;
                const cellWidth = Math.floor(5000 / Math.max(colCount, 1));

                for (const cell of row.content) {
                  const isHeader = cell.type === "tableHeader";
                  const cellParagraphs = cell.content
                    ? cell.content.map((p: any) => {
                      if (p.type === "paragraph") {
                        const children = this.extractTextRunsFromNode(p);
                        return new Paragraph({
                          children: children,
                          alignment: isHeader
                            ? AlignmentType.CENTER
                            : AlignmentType.LEFT,
                        });
                      }
                      return new Paragraph({ text: "" });
                    })
                    : [new Paragraph({ text: "" })];

                  cells.push(
                    new TableCell({
                      children: cellParagraphs,
                      width: {
                        size: cellWidth,
                        type: WidthType.PERCENTAGE,
                      },
                      shading: isHeader
                        ? {
                          fill: "D9D9D9",
                          color: "auto",
                        }
                        : undefined,
                      margins: {
                        top: 100,
                        bottom: 100,
                        left: 100,
                        right: 100,
                      },
                      verticalAlign: VerticalAlign.CENTER,
                    })
                  );
                }
              }
              if (cells.length > 0) {
                tableRows.push(new TableRow({ children: cells }));
              }
            }
          }
        }
        if (tableRows.length > 0) {
          paragraphs.push(
            new Table({
              rows: tableRows,
              style: "TableGrid",
              width: {
                size: 5000,
                type: WidthType.PERCENTAGE,
              },
            })
          );
        }
      } else if (node.type === "figure") {
        // Handle figure (container)
        const figureParagraphs = await this.convertTipTapToDOCXParagraphs(node);
        paragraphs.push(...figureParagraphs);
      } else if (node.type === "figcaption") {
        // Handle figcaption
        const children = this.extractTextRunsFromNode(node);
        paragraphs.push(
          new Paragraph({
            children: children,
            alignment: AlignmentType.CENTER,
            spacing: { before: 100, after: 200 },
            style: "Caption", // Assuming standard Word style or we can set italics manually
          })
        );
      } else {
        // Fallback for unknown node types or debugging
        logger.debug("Unknown or unhandled node type in DOCX export", {
          type: node.type,
        });
      }
    }

    return paragraphs;
  }

  /**
   * Extract styled TextRuns from a TipTap node
   */
  private static extractTextRunsFromNode(node: any): any[] {
    // Returns TextRun[]
    const { TextRun } = require("docx"); // Delay import to avoid top-level issues if not needed
    const runs: any[] = [];

    if (node.content) {
      node.content.forEach((child: any) => {
        if (child.type === "text") {
          let textContent = child.text || "";

          // Normalize line endings and handle unicode paragraph/line separators
          textContent = textContent
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n")
            .replace(/\u2028/g, "\n") // Line Separator
            .replace(/\u2029/g, "\n\n"); // Paragraph Separator

          // Split by newline to handle explicit line breaks in text nodes
          const parts = textContent.split("\n");

          parts.forEach((part: string, index: number) => {
            if (index > 0) {
              // Insert break for newline
              runs.push(new TextRun({ text: "", break: 1 }));
            }
            if (part) {
              const options: any = {
                text: part,
                size: 24, // 24 half-points = 12pt
              };

              if (child.marks) {
                child.marks.forEach((mark: any) => {
                  if (mark.type === "bold") options.bold = true;
                  if (mark.type === "italic") options.italics = true;
                  if (mark.type === "underline") options.underline = {};
                  if (mark.type === "strike") options.strike = true;
                });
              }
              runs.push(new TextRun(options));
            }
          });
        } else if (child.type === "hardBreak") {
          // Handle hard breaks (Shift+Enter)
          runs.push(new TextRun({ text: "", break: 1 }));
        } else if (child.type === "citation") {
          // Handle inline citation node
          // Assuming citation node has attrs.label or similar
          const label = child.attrs?.label || child.attrs?.text || "[Citation]";
          runs.push(new TextRun({ text: label }));
        }
      });
    }
    return runs;
  }

  /**
   * Format citation in specified style
   */
  private static formatCitation(citation: any, style: string): string {
    // Basic citation formatting
    const authors = citation.authors || citation.author || "Unknown";
    const title = citation.title || "Untitled";
    const year = citation.year || "n.d.";

    if (style === "apa") {
      return `${authors} (${year}). ${title}.`;
    } else if (style === "mla") {
      return `${authors}. "${title}." ${year}.`;
    } else {
      // Chicago
      return `${authors}. ${title}. ${year}.`;
    }
  }
}
