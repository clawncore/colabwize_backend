import logger from "../monitoring/logger";
import { Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";

// Interface for document metadata used in cover pages
interface DocumentMetadata {
  title: string;
  author?: string;
  institution?: string;
  course?: string;
  instructor?: string;
  date?: string;
  runningHead?: string;
}

// Interface for heading hierarchy
interface HeadingNode {
  level: number;
  text: string;
  children: HeadingNode[];
  pageNumber?: number;
}

// Interface for structural audit results
interface StructuralAuditResult {
  isValid: boolean;
  issues: string[];
  warnings: string[];
  stats: {
    hasTitle: boolean;
    headingCount: number;
    wordCount: number;
    minWordCountMet: boolean;
  };
}

export class PublicationService {
  /**
   * Generate APA 7th Edition compliant cover page
   */
  static generateAPACoverPage(metadata: DocumentMetadata): Paragraph[] {
    const coverPage: Paragraph[] = [];

    // Running head (top of page, max 50 characters)
    const runningHead =
      metadata.runningHead ||
      (metadata.title ? metadata.title.substring(0, 50).toUpperCase() : "");
    coverPage.push(
      new Paragraph({
        text: runningHead,
        alignment: AlignmentType.LEFT,
        spacing: { after: 200 },
        style: "Normal",
      })
    );

    // Vertical centering (add spacing)
    for (let i = 0; i < 8; i++) {
      coverPage.push(new Paragraph({ text: "" }));
    }

    // Title (bold, centered)
    coverPage.push(
      new Paragraph({
        children: [
          new TextRun({
            text: metadata.title,
            bold: true,
            size: 28, // 14pt
          }),
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );

    // Author name
    if (metadata.author) {
      coverPage.push(
        new Paragraph({
          text: metadata.author,
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        })
      );
    }

    // Institution/Course/Instructor
    const affiliationLines: string[] = [];
    if (metadata.institution) affiliationLines.push(metadata.institution);
    if (metadata.course) affiliationLines.push(metadata.course);
    if (metadata.instructor) affiliationLines.push(metadata.instructor);

    affiliationLines.forEach((line) => {
      coverPage.push(
        new Paragraph({
          text: line,
          alignment: AlignmentType.CENTER,
          spacing: { after: 100 },
        })
      );
    });

    // Date
    coverPage.push(
      new Paragraph({
        text:
          metadata.date ||
          new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          }),
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 },
      })
    );

    return coverPage;
  }

  /**
   * Generate MLA 8th Edition compliant cover page
   */
  static generateMLACoverPage(metadata: DocumentMetadata): Paragraph[] {
    const coverPage: Paragraph[] = [];

    // MLA format: upper-left corner, double-spaced
    const headerLines: string[] = [];
    if (metadata.author) headerLines.push(metadata.author);
    if (metadata.instructor) headerLines.push(metadata.instructor);
    if (metadata.course) headerLines.push(metadata.course);
    headerLines.push(
      metadata.date ||
        new Date().toLocaleDateString("en-US", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
    );

    headerLines.forEach((line) => {
      coverPage.push(
        new Paragraph({
          text: line,
          alignment: AlignmentType.LEFT,
          spacing: { after: 200 }, // Double-spacing
        })
      );
    });

    // Title (centered)
    coverPage.push(
      new Paragraph({
        text: metadata.title,
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: 200 },
      })
    );

    return coverPage;
  }

  /**
   * Extract Table of Contents from TipTap JSON content
   */
  static extractTOC(content: any): HeadingNode[] {
    const headings: HeadingNode[] = [];
    const stack: { node: HeadingNode; level: number }[] = [];

    const processNode = (node: any) => {
      if (node.type === "heading") {
        const level = node.attrs?.level || 1;
        let headingText = "";

        // Extract text from heading content
        if (node.content) {
          node.content.forEach((child: any) => {
            if (child.type === "text") {
              headingText += child.text || "";
            }
          });
        }

        const headingNode: HeadingNode = {
          level,
          text: headingText,
          children: [],
        };

        // Build hierarchy
        while (stack.length > 0 && stack[stack.length - 1].level >= level) {
          stack.pop();
        }

        if (stack.length === 0) {
          headings.push(headingNode);
        } else {
          stack[stack.length - 1].node.children.push(headingNode);
        }

        stack.push({ node: headingNode, level });
      }

      // Recursively process children
      if (node.content) {
        node.content.forEach(processNode);
      }
    };

    if (content) {
      processNode(content);
    }

    return headings;
  }

  /**
   * Generate TOC as DOCX paragraphs
   */
  static generateTOCParagraphs(
    headings: HeadingNode[],
    level: number = 0
  ): Paragraph[] {
    const tocParagraphs: Paragraph[] = [];

    headings.forEach((heading) => {
      const indent = level * 400; // Indent based on level
      const dotLeader = ".".repeat(
        Math.max(50 - heading.text.length - indent / 50, 3)
      );

      tocParagraphs.push(
        new Paragraph({
          text: `${heading.text}${dotLeader}${heading.pageNumber || "?"}`,
          indent: { left: indent },
          spacing: { after: 100 },
        })
      );

      // Recursively add children
      if (heading.children.length > 0) {
        tocParagraphs.push(
          ...this.generateTOCParagraphs(heading.children, level + 1)
        );
      }
    });

    return tocParagraphs;
  }

  /**
   * Perform structural fidelity audit on document
   */
  static performStructuralAudit(
    content: any,
    title: string,
    wordCount: number,
    minWordCount: number = 0
  ): StructuralAuditResult {
    const issues: string[] = [];
    const warnings: string[] = [];

    // Check for title
    const hasTitle = !!(title && title.trim().length > 0);
    if (!hasTitle) {
      issues.push("Document missing title");
    }

    // Extract and validate heading structure
    const headings = this.extractTOC(content);
    const headingCount = this.countHeadings(headings);

    if (headingCount === 0) {
      warnings.push(
        "No headings found - consider adding section headers for better structure"
      );
    }

    // Check for proper heading hierarchy
    const hierarchyIssues = this.validateHeadingHierarchy(headings);
    issues.push(...hierarchyIssues);

    // Check word count
    const minWordCountMet = wordCount >= minWordCount;
    if (!minWordCountMet && minWordCount > 0) {
      issues.push(
        `Word count (${wordCount}) below minimum requirement (${minWordCount})`
      );
    }

    // Check for content
    if (wordCount < 100) {
      warnings.push("Document appears to have minimal content (< 100 words)");
    }

    return {
      isValid: issues.length === 0,
      issues,
      warnings,
      stats: {
        hasTitle,
        headingCount,
        wordCount,
        minWordCountMet,
      },
    };
  }

  /**
   * Validate heading hierarchy (no skipped levels)
   */
  private static validateHeadingHierarchy(
    headings: HeadingNode[],
    expectedLevel: number = 1
  ): string[] {
    const issues: string[] = [];

    headings.forEach((heading) => {
      if (heading.level > expectedLevel + 1) {
        issues.push(
          `Heading hierarchy issue: "${heading.text}" skips from H${expectedLevel} to H${heading.level}`
        );
      }

      // Recursively check children
      if (heading.children.length > 0) {
        issues.push(
          ...this.validateHeadingHierarchy(heading.children, heading.level)
        );
      }
    });

    return issues;
  }

  /**
   * Count total headings recursively
   */
  private static countHeadings(headings: HeadingNode[]): number {
    let count = headings.length;
    headings.forEach((heading) => {
      count += this.countHeadings(heading.children);
    });
    return count;
  }

  /**
   * Merge document components (Cover + TOC + Body + References)
   */
  static mergeDocumentComponents(components: {
    coverPage?: Paragraph[];
    toc?: Paragraph[];
    body: Paragraph[];
    references?: Paragraph[];
  }): Paragraph[] {
    const merged: Paragraph[] = [];

    // Add cover page
    if (components.coverPage) {
      merged.push(...components.coverPage);
      // Page break after cover
      merged.push(
        new Paragraph({
          text: "",
          pageBreakBefore: true,
        })
      );
    }

    // Add TOC
    if (components.toc && components.toc.length > 0) {
      merged.push(
        new Paragraph({
          text: "Table of Contents",
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 400 },
        })
      );
      merged.push(...components.toc);
      // Page break after TOC
      merged.push(
        new Paragraph({
          text: "",
          pageBreakBefore: true,
        })
      );
    }

    // Add body content
    merged.push(...components.body);

    // Add references
    if (components.references && components.references.length > 0) {
      merged.push(
        new Paragraph({
          text: "",
          pageBreakBefore: true,
        })
      );
      merged.push(...components.references);
    }

    return merged;
  }

  /**
   * Get user metadata from database for cover page
   */
  static async getUserMetadata(
    userId: string
  ): Promise<Partial<DocumentMetadata>> {
    try {
      const { prisma } = await import("../lib/prisma");
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          full_name: true,
          email: true,
        },
      });

      return {
        author: user?.full_name || undefined,
      };
    } catch (error) {
      logger.error("Error fetching user metadata:", error);
      return {};
    }
  }
}
