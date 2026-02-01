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
  CommentRangeStart,
  CommentRangeEnd,
  CommentReference,
} from "docx";
import { PublicationService } from "./publicationService";
import AdmZip from "adm-zip";

// --- NUCLEAR OPTION: DEBUG FLAGS ---
// Granular control to isolate the crash source.
const DEBUG_FLAGS = {
  SKIP_IMAGES: false,   // ✅ Re-enable Images
  SKIP_TABLES: false,  // ✅ Keep Tables enabled
  SKIP_COMMENTS: true, // ⚠️ Keep comments DISABLED
  SKIP_COLUMNS: true,  // ⚠️ Keep columns DISABLED
  USE_PLACEHOLDER_IMAGES: false, // ✅ Disable placeholder, test REAL images
};

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
  wordSafeMode?: boolean; // Enable strict Word compatibility (disables TOC, columns, complex features)
  metadata?: {
    author?: string;
    institution?: string;
    course?: string;
    instructor?: string;
    runningHead?: string;
    abstract?: string;
  };
  citationPolicy?: {
    mode: string;
    excludeOrphanReferences: boolean;
    markUnsupportedClaims: boolean;
    violations?: any[];
    wordSafeMode?: boolean; // Pass through to image processing
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
      /* DISABLED PER USER REQUEST - MANUAL COVER PAGE ONLY
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
      */

      // 4b. Generate Abstract Page
      let abstractParagraphs: Paragraph[] | undefined;
      /* DISABLED PER USER REQUEST - CONTENT ABSTRACT ONLY
      if (options.metadata?.abstract) {
        abstractParagraphs = [
          new Paragraph({
            text: "Abstract",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
            pageBreakBefore: true, // Abstract on new page after title
          }),
          new Paragraph({
            text: options.metadata.abstract,
            alignment: AlignmentType.LEFT, // APA 7 abstract is not indented
            spacing: { line: 360 }, // Double spaced
          }),
          // Keywords could go here if we collected them
          new Paragraph({
            text: "",
            pageBreakBefore: true, // Body starts on new page
          }),
        ];
      }
      */


      // 5. Native TOC Generation (DISABLED IN WORD-SAFE MODE)
      let tocParagraphs: (Paragraph | TableOfContents)[] | undefined;
      if (options.includeTOC && !options.wordSafeMode) {
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
          // REMOVED explicit page break paragraph here, rely on mergeDocumentComponents separator
        ];
      } else if (options.includeTOC && options.wordSafeMode) {
        logger.info("TOC disabled in Word-safe mode to prevent section break issues");
      }

      // 6. Convert body content to paragraphs (Collect comments here)
      const comments: any[] = [];
      const usedCitationIds = new Set<string>();
      let bodyParagraphs = await this.convertTipTapToDOCXParagraphs(
        project.content,
        project.citations || [],
        options.citationStyle || "apa",
        {
          ...options.citationPolicy,
          wordSafeMode: options.wordSafeMode // Pass through for image/column processing
        },
        comments,
        usedCitationIds
      );

      // --- FIX: Filter empty paragraphs logic ---
      // Simple heuristic: if we could inspect content, we would.
      // For now, let's rely on convertTipTapToDOCXParagraphs mostly,
      // but strictly preventing empty Body paragraphs if they have no Runs is hard without strict typing.
      // We will perform HEADINGS CHECK here.

      const contentHeadings = new Set<string>();
      const extractHeadings = (node: any) => {
        if (node.type === 'heading') {
          const text = node.content?.map((c: any) => c.text).join('') || '';
          contentHeadings.add(text.toLowerCase().trim());
        }
        if (node.content) node.content.forEach(extractHeadings);
      };
      if (project.content) extractHeadings(project.content);

      const hasAbstract = contentHeadings.has("abstract");
      const hasReferences = contentHeadings.has("references") || contentHeadings.has("bibliography") || contentHeadings.has("works cited");

      // 4b. Re-Evaluate Abstract Page (since we moved logic down to check content)
      // Note: We defined abstractParagraphs earlier (lines 149-170). 
      // We should overwrite it if hasAbstract is true.
      if (hasAbstract && abstractParagraphs) {
        abstractParagraphs = undefined; // Suppress auto-generated abstract
        logger.info("Suppressing auto-abstract because document already has Abstract heading");
      }

      // 7b. Generate Authorship Certificate
      const certificateParagraphs: Paragraph[] = [];
      if (options.includeAuthorshipCertificate) {
        try {
          // Dynamic imports to avoid excessive boilerplate in this method if not needed
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
                    width: 600,
                    height: 450,
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

      // 7. Generate references section (Conditional)
      const referencesParagraphs: Paragraph[] = [];

      let citationsToUse = project.citations || [];
      // Filter orphan references
      if (options.citationPolicy?.excludeOrphanReferences && usedCitationIds.size > 0) {
        citationsToUse = citationsToUse.filter((c: any) => usedCitationIds.has(c.id));
      }

      // Only generate References if not already in document
      if (citationsToUse.length > 0 && !hasReferences) {
        referencesParagraphs.push(
          new Paragraph({
            text: "References",
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 400, after: 200 },
            pageBreakBefore: true,
          })
        );
        citationsToUse.forEach((citation: any, index: number) => {
          referencesParagraphs.push(
            new Paragraph({
              text: `${index + 1}. ${this.formatCitation(citation, options.citationStyle || "apa")}`,
              spacing: { after: 100 },
            })
          );
        });
      } else if (hasReferences) {
        logger.info("Suppressing auto-references because document already has References heading");
      }

      // Append certificate (Certificate usually goes last)
      // We will append it to references or body
      if (certificateParagraphs.length > 0) {
        if (referencesParagraphs.length > 0) {
          referencesParagraphs.push(...certificateParagraphs);
        } else {
          // If no references generated (or suppressed), append to body?
          // But mergeDocumentComponents puts body before references.
          // So if referencesParagraphs is empty, we must ensure it's passed or append to body.
          // Let's passed it as references if empty.
          referencesParagraphs.push(...certificateParagraphs);
        }
      }

      // 8. Merge all components
      // Clean up bodyParagraphs: Filter out truly empty paragraphs (heuristic: no text, no children)
      // This is hard to do cleanly on Paragraph objects without type issues.
      // We will trust Tiptap conversion for now but fixing the double page breaks above (suppression) helps.

      const allParagraphs = PublicationService.mergeDocumentComponents({
        coverPage: coverPageParagraphs,
        toc: tocParagraphs ? (abstractParagraphs ? [...abstractParagraphs, ...tocParagraphs] : tocParagraphs) : undefined,
        body: (!options.includeTOC && abstractParagraphs) ? [...abstractParagraphs, ...bodyParagraphs] : bodyParagraphs,
        references: referencesParagraphs.length > 0 ? referencesParagraphs : undefined,
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
        // Only include comments if they exist AND NOT STRICT MODE
        comments: (comments.length > 0 && !DEBUG_FLAGS.SKIP_COMMENTS) ? {
          children: comments,
        } : undefined,
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

      // 10a. CRITICAL: Validate DOCX package structure for Word compatibility
      const validation = this.validateDOCXPackage(buffer);

      if (!validation.isValid) {
        logger.error("❌ DOCX package validation FAILED - Word will reject this file!", {
          errors: validation.errors,
          warnings: validation.warnings
        });

        // Log each error for debugging
        validation.errors.forEach((error, i) => {
          logger.error(`Validation Error ${i + 1}:`, { error });
        });
      } else {
        logger.info("✅ DOCX package validation PASSED - file should open in Word", {
          warningCount: validation.warnings.length
        });
      }

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
   * Sanitize text to remove invalid XML characters (CRITICAL for Word)
   * Removes control characters forbidden in XML 1.0 (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F)
   */
  private static sanitizeText(text: string | null | undefined): string {
    if (!text) return "";
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  }

  /**
   * Validate and fetch image - CRITICAL for Word compatibility
   * This method validates images BEFORE creating ImageRun to prevent dangling relationships
   */
  private static async validateAndFetchImage(src: string, attrs?: any): Promise<{
    buffer: Buffer;
    format: "png" | "jpg" | "gif" | "bmp";
    dimensions: { width: number; height: number };
  } | null> {

    // --- DEBUG: USE PLACEHOLDER IMAGE ---
    if (DEBUG_FLAGS.USE_PLACEHOLDER_IMAGES) {
      // 1x1 JPEG (Safer than PNG for Word/DOCX compat)
      const base64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAQAAAAAAAAAAAAAAAAAAAAH/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwB/gA==";
      return {
        buffer: Buffer.from(base64, "base64"),
        format: "jpeg" as any, // 🛑 CRITICAL FIX: Word demands "jpeg"
        dimensions: { width: 100, height: 100 }
      };
    }

    // Skip unsupported sources FIRST
    if (src.startsWith("blob:")) {
      logger.warn("Skipping blob URL in export - cannot resolve server-side", { src });
      return null;
    }

    logger.debug("Validating and fetching image for DOCX export", { src });

    let data: Buffer | undefined;

    // Fetch image data based on source type
    if (src.startsWith("data:")) {
      // Data URI - decode base64
      const matches = src.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const base64Data = matches[2];
        data = Buffer.from(base64Data, "base64");
      }
    } else if (src.startsWith("http")) {
      // HTTP URL - fetch
      try {
        const response = await fetch(src, {
          headers: { 'User-Agent': 'ColabWize-Export-Service' }
        });

        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          data = Buffer.from(arrayBuffer);
        } else {
          logger.warn("Failed to fetch image", { status: response.status, src });
          return null;
        }
      } catch (e) {
        logger.warn("Fetch failed", { error: e });
        return null;
      }
    } else {
      // Relative URL - convert to full URL
      const appUrl = await SecretsService.getAppUrl();
      const fullUrl = src.startsWith("/")
        ? `${appUrl}${src}`
        : `${appUrl}/${src}`;

      try {
        const response = await fetch(fullUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          data = Buffer.from(arrayBuffer);
        } else {
          logger.warn("Failed to fetch relative image", { fullUrl });
          return null;
        }
      } catch (err) {
        logger.warn("Error fetching relative image URL", { error: err, fullUrl });
        return null;
      }
    }

    // Validate data exists and has minimum size
    if (!data || data.length < 100) {
      logger.warn("Image data too small or empty", { size: data?.length || 0 });
      return null;
    }

    // --- MAGIC BYTE VALIDATION (CRITICAL for Word) ---
    let detectedType: "png" | "jpg" | "gif" | "bmp" | null = null;

    // Check for PNG: 89 50 4E 47
    if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4E && data[3] === 0x47) {
      detectedType = "png";
    }
    // Check for JPEG: FF D8 FF
    else if (data[0] === 0xFF && data[1] === 0xD8 && data[2] === 0xFF) {
      detectedType = "jpg";
    }
    // Check for GIF: 47 49 46 38
    else if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) {
      detectedType = "gif";
    }
    // Check for BMP: 42 4D
    else if (data[0] === 0x42 && data[1] === 0x4D) {
      detectedType = "bmp";
    }

    if (!detectedType) {
      logger.warn("Invalid or unsupported image format detected", {
        firstBytes: data.subarray(0, 8).toString('hex'),
        src
      });
      return null;
    }

    // --- HTML/TEXT CHECK (Prevent 404 pages from being embedded) ---
    const snippet = data.subarray(0, 100).toString('utf8').toLowerCase();
    if (snippet.includes("<!doctype") || snippet.includes("<html") || snippet.includes("<body")) {
      logger.warn("Image buffer contains HTML/text, likely a 404 page. Skipping to prevent DOCX corruption.", { src });
      return null;
    }

    // Parse dimensions
    const parseDim = (val: any) => {
      const parsed = parseInt(String(val).replace("px", ""), 10);
      return isNaN(parsed) || parsed <= 0 ? null : parsed;
    };

    const userWidth = attrs?.width ? parseDim(attrs.width) : null;
    const userHeight = attrs?.height ? parseDim(attrs.height) : null;

    // ALL VALIDATION PASSED - return image data
    logger.debug("Image validated successfully", {
      format: detectedType,
      size: data.length,
      dimensions: { width: userWidth || 400, height: userHeight || 300 }
    });

    return {
      buffer: data,
      format: detectedType,
      dimensions: {
        width: userWidth || 400,
        height: userHeight || 300
      }
    };
  }

  /**
   * Validate DOCX package structure (CRITICAL for Word compatibility)
   * Inspects the ZIP to check for structural issues that break Word
   */
  private static validateDOCXPackage(buffer: Buffer): {
    isValid: boolean;
    errors: string[];
    warnings: string[];
  } {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const zip = new AdmZip(buffer);
      const entries = zip.getEntries();

      logger.debug("Validating DOCX package structure", {
        totalEntries: entries.length
      });

      // 1. Check for required files
      const requiredFiles = [
        'word/document.xml',
        '[Content_Types].xml',
        '_rels/.rels'
      ];

      for (const file of requiredFiles) {
        const entry = zip.getEntry(file);
        if (!entry) {
          errors.push(`Missing required file: ${file}`);
        }
      }

      // 2. Check for dangling relationships
      const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
      if (relsEntry) {
        const relsXml = relsEntry.getData().toString('utf8');

        // Extract all Target attributes from relationships
        const relationshipMatches = relsXml.matchAll(/Target="([^"]+)"/g);

        for (const match of relationshipMatches) {
          const target = match[1];

          // Skip external  relationships (http://, mailto:, etc.)
          if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('mailto:')) {
            continue;
          }

          // Build the full path to check
          const targetPath = target.startsWith('/') ? target.substring(1) : `word/${target}`;

          // Check if target file exists in ZIP
          const targetEntry = zip.getEntry(targetPath);
          if (!targetEntry) {
            errors.push(`Dangling relationship: ${target} → ${targetPath} does not exist in package`);
          }
        }
      }

      // 3. Check media files are non-zero (skip directory entries)
      const mediaEntries = entries.filter((e: any) =>
        e.entryName.startsWith('word/media/') && !e.isDirectory
      );
      for (const entry of mediaEntries) {
        if (entry.header.size === 0) {
          errors.push(`Empty media file: ${entry.entryName}`);
        }
      }

      // 4. Check Content_Types.xml
      const contentTypesEntry = zip.getEntry('[Content_Types].xml');
      if (contentTypesEntry) {
        const contentTypesXml = contentTypesEntry.getData().toString('utf8');

        // Check that all media files have content type entries
        for (const mediaEntry of mediaEntries) {
          const ext = mediaEntry.entryName.split('.').pop()?.toLowerCase();
          if (ext && !contentTypesXml.includes(`Extension="${ext}"`)) {
            warnings.push(`Media file ${mediaEntry.entryName} may not have content type registered`);
          }
        }
      }

      logger.info("DOCX package validation complete", {
        isValid: errors.length === 0,
        errorCount: errors.length,
        warningCount: warnings.length
      });

    } catch (error: any) {
      errors.push(`Failed to parse DOCX package: ${error.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Convert TipTap JSON to DOCX Paragraphs (enhanced version)
   */
  private static async convertTipTapToDOCXParagraphs(
    content: any,
    citations: any[] = [],
    style: string = "apa",
    citationPolicy?: any,
    commentsRef: any[] = [],
    usedCitationIds?: Set<string>
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
      // FIX: Strip empty paragraphs to prevent blank pages
      if (node.type === "paragraph") {
        const hasContent = node.content && node.content.some((c: any) => {
          // Keep if text exists
          if (c.text && c.text.trim().length > 0) return true;
          // Keep if it contains non-text nodes like images, mentions, or hardBreaks
          // Note: hardBreak might be considered "whitespace" but it's explicit formatting.
          // We'll be conservative and keep anything that isn't just empty text.
          if (c.type !== 'text') return true;
          return false;
        });

        // If content array is empty or all elements are empty text nodes, skip.
        if (!hasContent) {
          continue;
        }
      }

      if (node.type === "paragraph") {
        const children = this.extractTextRunsFromNode(node, citations, style, citationPolicy, commentsRef, usedCitationIds);
        paragraphs.push(
          new Paragraph({
            children: children,
            spacing: { line: 360, after: 140 }, // 1.5 line spacing + 7pt after
          })
        );
      } else if (node.type === "heading") {
        const children = this.extractTextRunsFromNode(node, citations, style, citationPolicy, commentsRef, usedCitationIds);
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
                  const children = this.extractTextRunsFromNode(childNode, citations, style, citationPolicy, commentsRef, usedCitationIds);
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
        // STRICT MODE: SKIP ALL IMAGES
        if (DEBUG_FLAGS.SKIP_IMAGES) {
          logger.debug("DEBUG MODE: Skipping image node");
          paragraphs.push(new Paragraph({ text: "[IMAGE REMOVED IN DEBUG MODE]" }));
          continue;
        }

        // CRITICAL: Validate image BEFORE creating ImageRun to prevent dangling relationships
        const validatedImage = await this.validateAndFetchImage(node.attrs.src, node.attrs);

        if (validatedImage === null) {
          // Image validation failed - don't create paragraph or ImageRun at all
          // This prevents dangling relationships in the DOCX package
          logger.debug("Image validation failed, skipping image node entirely");
          continue;
        }

        // Image is valid - create ImageRun (relationship will be created here)
        paragraphs.push(
          new Paragraph({
            children: [
              new ImageRun({
                data: validatedImage.buffer,
                transformation: validatedImage.dimensions,
                type: validatedImage.format === "jpg" ? "jpeg" as any : validatedImage.format as any, // 🛑 CRITICAL FIX
                // altText: node.attrs.alt || "Image", // REMOVED for safety
              }),
            ],
            spacing: { before: 240, after: 240 },
            alignment: node.attrs.align === "center"
              ? AlignmentType.CENTER
              : node.attrs.align === "right"
                ? AlignmentType.RIGHT
                : AlignmentType.LEFT,
          })
        );
      } else if ((node.type === "columns" || node.type === "columnLayout") && !citationPolicy?.wordSafeMode) {
        // STRICT MODE: SKIP COLUMNS
        if (DEBUG_FLAGS.SKIP_COLUMNS) {
          // Treating columns as simple paragraphs in strict mode to avoid complexity
          // Fall through or just process content linearly? 
          // For now, let's just skip the complex layout and extract content if possible, 
          // or just skip to be safe. Let's just skip layout logic.
          continue;
        }

        // Handle multi-column layout (DISABLED IN WORD-SAFE MODE)
        const numColumns = parseInt(node.attrs?.columns || "2", 10);

        if (node.content && node.content.length > 0) {
          const tableRows: TableRow[] = [];
          const isNestedStructure = node.content.some((c: any) => c.type === "column");

          if (isNestedStructure) {
            // Old nested logic
            const columnCells = [];
            for (const column of node.content) {
              if (column.type === "column") {
                const columnParagraphs = await this.convertTipTapToDOCXParagraphs(column, citations, style, citationPolicy, commentsRef);
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
              const cellParagraphs = await this.convertTipTapToDOCXParagraphs({ content: [item] }, citations, style, citationPolicy, commentsRef);

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
        // STRICT MODE: SKIP TABLES
        if (DEBUG_FLAGS.SKIP_TABLES) {
          logger.debug("DEBUG MODE: Skipping table node");
          paragraphs.push(new Paragraph({ text: "[TABLE REMOVED IN DEBUG MODE]" }));
          continue;
        }

        // Handle table
        const tableRows = [];
        if (node.content) {
          // Use maxCols from Normalizer to ensure rectangularity
          const maxCols = node.attrs?.maxCols || 1;
          const cellWidth = Math.floor(5000 / maxCols);

          for (const row of node.content) {
            if (row.type === "tableRow") {
              const cells = [];
              if (row.content) {
                for (const cell of row.content) {
                  const isHeader = cell.type === "tableHeader";
                  const cellParagraphs = cell.content
                    ? cell.content.map((p: any) => {
                      if (p.type === "paragraph") {
                        const children = this.extractTextRunsFromNode(p, citations, style, citationPolicy, commentsRef, usedCitationIds);
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
        const figureParagraphs = await this.convertTipTapToDOCXParagraphs(node, citations, style, citationPolicy, commentsRef, usedCitationIds);
        paragraphs.push(...figureParagraphs);
      } else if (node.type === "figcaption") {
        // Handle figcaption
        const children = this.extractTextRunsFromNode(node, citations, style, citationPolicy, commentsRef, usedCitationIds);
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
  private static extractTextRunsFromNode(
    node: any,
    citations: any[] = [],
    style: string = "apa",
    citationPolicy?: any,
    commentsRef: any[] = [],
    usedCitationIds?: Set<string>
  ): any[] {
    const { TextRun } = require("docx");
    const runs: any[] = [];

    // Check for violations in this node context
    let violationCommentId: number | null = null;

    // If citationPolicy.markUnsupportedClaims is true and we have violations:
    if (citationPolicy?.markUnsupportedClaims && citationPolicy.violations && node.content) {
      // Collect text content of this node for matching
      const fullText = node.content.map((c: any) => PublicationExportService.sanitizeText(c.text || "")).join("");

      // Find if this text contains any violation context
      // Matching logic: simple substring check or fuzzy match on start
      const violation = citationPolicy.violations.find((v: any) =>
        v.context && fullText.includes(v.context.substring(0, 50))
      );

      if (violation) {
        violationCommentId = commentsRef.length + 1;
        commentsRef.push({
          id: violationCommentId,
          author: "Citation Audit",
          date: new Date(),
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: PublicationExportService.sanitizeText(`[${violation.ruleId}] ${violation.message || "Potential citation issue detected."}`),
                  bold: true,
                }),
              ],
            }),
          ],
        });

        // Add Start Range
        runs.push(new CommentRangeStart(violationCommentId));
      }
    }

    if (node.content) {
      node.content.forEach((child: any) => {
        if (child.type === "text") {
          let textContent = PublicationExportService.sanitizeText(child.text || "");

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
          // Handle inline citation node (Semantic)
          const citationId = child.attrs?.citationId;
          const fallback = PublicationExportService.sanitizeText(child.attrs?.fallback || "[Citation]");

          if (citationId && citations.length > 0) {
            if (usedCitationIds) usedCitationIds.add(citationId);
            const citationData = citations.find(c => c.id === citationId);
            if (citationData) {
              const inText = this.formatInTextCitation(citationData, style);
              runs.push(new TextRun({ text: inText, bold: child.marks?.some((m: any) => m.type === "bold"), italics: child.marks?.some((m: any) => m.type === "italic") }));
            } else {
              runs.push(new TextRun({ text: fallback, color: "FF0000" })); // Red for missing ref?
            }
          } else {
            runs.push(new TextRun({ text: fallback }));
          }
        }
      });
    }

    // Add End Range if comment was started
    if (violationCommentId !== null) {
      runs.push(new CommentRangeEnd(violationCommentId));
      runs.push(new CommentReference(violationCommentId)); // Visual marker
    }

    return runs;
  }

  /**
   * Format in-text citation (e.g., "(Smith, 2023)")
   */
  private static formatInTextCitation(citation: any, style: string): string {
    const authors = Array.isArray(citation.authors) ? citation.authors : [citation.author || "Unknown"];
    const year = citation.year || "n.d.";

    // Get last name of first author
    const firstAuthor = authors[0] || "Unknown";
    let authorText = typeof firstAuthor === 'string' ? firstAuthor : (firstAuthor.lastName || firstAuthor.firstName || "Unknown");

    if (authors.length > 2) {
      authorText += " et al.";
    } else if (authors.length === 2) {
      const secondAuthor = authors[1];
      const secondAuthorText = typeof secondAuthor === 'string' ? secondAuthor : (secondAuthor.lastName || "Unknown");
      authorText += ` & ${secondAuthorText}`;
    }

    if (style === "apa") {
      return `(${authorText}, ${year})`;
    } else if (style === "mla") {
      return `(${authorText})`;
    } else if (style === "ieee") {
      // In a real IEEE export, we would need the citation index. 
      // For now, let's use the author/year format as a readable placeholder until we implement ordering.
      return `[${authorText}, ${year}]`;
    }

    return `(${authorText}, ${year})`;
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
