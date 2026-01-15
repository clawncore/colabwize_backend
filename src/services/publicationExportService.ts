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
} from "docx";
import { PublicationService } from "./publicationService";

interface PublicationExportOptions {
  format: "pdf" | "docx";
  citationStyle?: "apa" | "mla" | "chicago";
  includeCoverPage: boolean;
  coverPageStyle: "apa" | "mla";
  includeTOC: boolean;
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

      // 5. Extract TOC if requested
      let tocParagraphs: Paragraph[] | undefined;
      if (options.includeTOC) {
        const headings = PublicationService.extractTOC(project.content);
        if (headings.length > 0) {
          tocParagraphs = PublicationService.generateTOCParagraphs(headings);
          logger.debug("Generated TOC", { headingCount: headings.length });
        } else {
          logger.warn("TOC requested but no headings found in document", {
            projectId,
          });
        }
      }

      // 6. Convert body content to paragraphs
      const bodyParagraphs = await this.convertTipTapToDOCXParagraphs(
        project.content
      );

      // 7. Generate references section
      const referencesParagraphs: Paragraph[] = [];
      if (project.citations && project.citations.length > 0) {
        referencesParagraphs.push(
          new Paragraph({
            text: "References",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 400, after: 200 },
          })
        );

        project.citations.forEach((citation: any, index: number) => {
          referencesParagraphs.push(
            new Paragraph({
              text: `${index + 1}. ${this.formatCitation(citation, options.citationStyle || "apa")}`,
              spacing: { after: 100 },
            })
          );
        });
      }

      // 8. Merge all components
      const allParagraphs = PublicationService.mergeDocumentComponents({
        coverPage: coverPageParagraphs,
        toc: tocParagraphs,
        body: bodyParagraphs,
        references:
          referencesParagraphs.length > 0 ? referencesParagraphs : undefined,
      });

      // 9. Create DOCX document
      const doc = new Document({
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
  ): Promise<Paragraph[]> {
    const paragraphs: Paragraph[] = [];

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
      } else if (node.type === "image" && node.attrs?.src) {
        try {
          const src = node.attrs.src;
          logger.debug("Processing image for DOCX export", { src });

          let data: Buffer | string | Uint8Array | undefined;

          if (src.startsWith("data:")) {
            const base64Data = src.split(",")[1];
            if (base64Data) {
              data = Buffer.from(base64Data, "base64");
            }
          } else if (src.startsWith("http")) {
            const response = await fetch(src);
            const arrayBuffer = await response.arrayBuffer();
            data = Buffer.from(arrayBuffer);
          } else {
            // Handle relative URLs or local paths by trying to resolve against app URL or storage
            // This assumes the app is running and accessible or the path is relative to public
            // For now, let's try to construct a full URL if we have a base
            const appUrl = await SecretsService.getAppUrl();
            const fullUrl = src.startsWith("/")
              ? `${appUrl}${src}`
              : `${appUrl}/${src}`;

            logger.debug("Attempting to fetch relative image URL", {
              src,
              fullUrl,
            });

            try {
              const response = await fetch(fullUrl);
              if (response.ok) {
                const arrayBuffer = await response.arrayBuffer();
                data = Buffer.from(arrayBuffer);
              } else {
                logger.warn("Failed to fetch relative image", {
                  status: response.status,
                  fullUrl,
                });
              }
            } catch (err) {
              logger.warn("Error fetching relative image URL", {
                error: err,
                fullUrl,
              });
            }
          }

          if (data) {
            paragraphs.push(
              new Paragraph({
                children: [
                  new ImageRun({
                    data: data,
                    transformation: {
                      width: 400,
                      height: 300,
                    },
                  }),
                ],
                spacing: { before: 240, after: 240 },
              })
            );
          } else {
            logger.warn("Could not retrieve image data", { src });
          }
        } catch (e: any) {
          logger.warn("Failed to process image for DOCX export", {
            error: e.message,
            stack: e.stack,
            src: node.attrs?.src,
          });
        }
      } else if (node.type === "columns") {
        // Handle multi-column layout
        // DOCX library doesn't directly support columns like CSS, so we'll use a table with invisible borders
        if (node.content) {
          const columnCells = [];
          for (const column of node.content) {
            if (column.type === "column") {
              const columnParagraphs =
                await this.convertTipTapToDOCXParagraphs(column);
              columnCells.push(
                new TableCell({
                  children:
                    columnParagraphs.length > 0
                      ? columnParagraphs
                      : [new Paragraph({ text: "" })],
                  borders: {
                    top: { style: "none" },
                    bottom: { style: "none" },
                    left: { style: "none" },
                    right: { style: "none" },
                  },
                  width: {
                    size: 100 / node.content.length,
                    type: WidthType.PERCENTAGE,
                  },
                  verticalAlign: VerticalAlign.TOP,
                })
              );
            }
          }
          if (columnCells.length > 0) {
            paragraphs.push(
              new Paragraph({
                children: [
                  new Table({
                    rows: [
                      new TableRow({
                        children: columnCells,
                      }),
                    ],
                    width: {
                      size: 100,
                      type: WidthType.PERCENTAGE,
                    },
                  }),
                ] as any,
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
                      shading: isHeader
                        ? {
                            fill: "D9D9D9",
                            color: "auto",
                          }
                        : undefined,
                      borders: {
                        top: { style: "single", size: 1, color: "000000" },
                        bottom: { style: "single", size: 1, color: "000000" },
                        left: { style: "single", size: 1, color: "000000" },
                        right: { style: "single", size: 1, color: "000000" },
                      },
                      verticalAlign: VerticalAlign.TOP,
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
            new Paragraph({
              children: [
                new Table({
                  rows: tableRows,
                  width: {
                    size: 100,
                    type: WidthType.PERCENTAGE,
                  },
                }),
              ] as any,
            })
          );
        }
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
