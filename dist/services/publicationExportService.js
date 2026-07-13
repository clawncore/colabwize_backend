"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicationExportService = void 0;
const logger_1 = __importDefault(require("../monitoring/logger"));
const secrets_service_1 = require("./secrets-service");
const docx_1 = require("docx");
const publicationService_1 = require("./publicationService");
const documentUploadService_1 = require("./documentUploadService");
const adm_zip_1 = __importDefault(require("adm-zip"));
// --- NUCLEAR OPTION: DEBUG FLAGS ---
// Granular control to isolate the crash source.
const DEBUG_FLAGS = {
    SKIP_IMAGES: false, // ✅ Re-enable Images
    SKIP_TABLES: false, // ✅ Keep Tables enabled
    SKIP_COMMENTS: true, // ⚠️ Keep comments DISABLED
    SKIP_COLUMNS: true, // ⚠️ Keep columns DISABLED
    USE_PLACEHOLDER_IMAGES: false, // ✅ Disable placeholder, test REAL images
};
class PublicationExportService {
    /**
     * Export project as publication-ready document with cover page, TOC, and structural audit
     * This is the MVP "One-Click Publication Suite" feature
     */
    static async exportPublicationReady(projectId, userId, options) {
        try {
            logger_1.default.info("Starting publication-ready export", {
                projectId,
                userId,
                includeCoverPage: options.includeCoverPage,
                includeTOC: options.includeTOC,
            });
            // 1. Fetch project data using DocumentUploadService
            const project = await documentUploadService_1.DocumentUploadService.getProjectById(projectId, userId);
            if (!project) {
                throw new Error("Project not found or access denied");
            }
            // 2. Perform structural audit if requested
            let auditResults;
            if (options.performStructuralAudit) {
                auditResults = publicationService_1.PublicationService.performStructuralAudit(project.content, project.title, project.word_count, options.minWordCount || 0);
                if (!auditResults.isValid) {
                    logger_1.default.warn("Structural audit found issues", {
                        projectId,
                        issues: auditResults.issues,
                    });
                    // Continue with export but include audit results
                }
                if (auditResults.warnings.length > 0) {
                    logger_1.default.info("Structural audit warnings", {
                        projectId,
                        warnings: auditResults.warnings,
                    });
                }
            }
            // 3. Get user metadata for cover page
            const userMetadata = await publicationService_1.PublicationService.getUserMetadata(userId);
            // 4. Generate document components
            let coverPageParagraphs;
            if (options.includeCoverPage) {
                const metadata = {
                    title: project.title,
                    author: options.metadata?.author || userMetadata.author,
                    institution: options.metadata?.institution,
                    course: options.metadata?.course,
                    instructor: options.metadata?.instructor,
                    date: new Date().toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                    }),
                };
                coverPageParagraphs = [
                    new docx_1.Paragraph({
                        children: [new docx_1.TextRun({ text: "", break: 6 })], // Spacing
                    }),
                    new docx_1.Paragraph({
                        text: metadata.title,
                        heading: docx_1.HeadingLevel.HEADING_1,
                        alignment: docx_1.AlignmentType.CENTER,
                        spacing: { after: 200 },
                    }),
                    new docx_1.Paragraph({
                        text: metadata.author || "",
                        alignment: docx_1.AlignmentType.CENTER,
                        spacing: { before: 400 },
                    }),
                    new docx_1.Paragraph({
                        text: metadata.institution || "",
                        alignment: docx_1.AlignmentType.CENTER,
                    }),
                    new docx_1.Paragraph({
                        text: metadata.course || "",
                        alignment: docx_1.AlignmentType.CENTER,
                    }),
                    new docx_1.Paragraph({
                        text: metadata.instructor || "",
                        alignment: docx_1.AlignmentType.CENTER,
                    }),
                    new docx_1.Paragraph({
                        text: metadata.date || "",
                        alignment: docx_1.AlignmentType.CENTER,
                    }),
                ].filter((p) => p !== undefined);
                logger_1.default.debug("Generated professional cover page", { metadata });
            }
            // 4b. Generate Abstract Page
            let abstractParagraphs;
            if (options.metadata?.abstract) {
                abstractParagraphs = [
                    new docx_1.Paragraph({
                        text: "Abstract",
                        heading: docx_1.HeadingLevel.HEADING_1,
                        alignment: docx_1.AlignmentType.CENTER,
                        spacing: { after: 240 },
                        pageBreakBefore: true, // Start abstract on new page
                    }),
                    new docx_1.Paragraph({
                        text: options.metadata.abstract,
                        alignment: docx_1.AlignmentType.LEFT,
                        spacing: { line: 360 }, // Double spaced
                    }),
                ];
            }
            // 5. Native TOC Generation (DISABLED IN WORD-SAFE MODE)
            let tocParagraphs;
            if (options.includeTOC && !options.wordSafeMode) {
                // Using Native Word TOC instead of manual paragraphs
                // This allows Word to handle page numbers and updates
                tocParagraphs = [
                    new docx_1.Paragraph({
                        text: "Table of Contents",
                        heading: docx_1.HeadingLevel.HEADING_1,
                        alignment: docx_1.AlignmentType.CENTER,
                        spacing: { after: 400 },
                        pageBreakBefore: true, // Start TOC on new page
                    }),
                    new docx_1.TableOfContents("Summary", {
                        hyperlink: true,
                        headingStyleRange: "1-3",
                    }),
                ];
            }
            else if (options.includeTOC && options.wordSafeMode) {
                logger_1.default.info("TOC disabled in Word-safe mode to prevent section break issues");
            }
            // 6. Convert body content to paragraphs (Collect comments here)
            const comments = [];
            const usedCitationIds = new Set();
            const state = { citationNodeIndex: 0 };
            const citationsToPass = options.citations || project.citations || [];
            const bodyParagraphs = await this.convertTipTapToDOCXParagraphs(project.content, citationsToPass, options.citationStyle || "apa", options.citationPolicy, comments, usedCitationIds, state, {
                wordSafeMode: options.wordSafeMode,
                resolvedCitations: options.resolvedCitations,
                startOnNewPage: !!(coverPageParagraphs ||
                    abstractParagraphs ||
                    tocParagraphs),
                ownerId: project.user_id, // Pass ownerId for collaborative tracking
            });
            // --- FIX: Filter empty paragraphs logic ---
            // Simple heuristic: if we could inspect content, we would.
            // For now, let's rely on convertTipTapToDOCXParagraphs mostly,
            // but strictly preventing empty Body paragraphs if they have no Runs is hard without strict typing.
            // We will perform HEADINGS CHECK here.
            const contentMarkers = new Set();
            const scanForMarkers = (node) => {
                if (node.type === "heading" || node.type === "paragraph") {
                    const text = node.content?.map((c) => c.text).join("") || "";
                    const cleanText = text.toLowerCase().trim();
                    // Detect common bibliography headers even if they are just paragraphs
                    const isBib = /^(references|bibliography|works cited|references cited|bibliography and references)($|:|\s)/.test(cleanText);
                    if (node.type === "heading" || isBib) {
                        contentMarkers.add(cleanText);
                        if (isBib)
                            contentMarkers.add("force_bib_suppress");
                    }
                }
                if (node.content)
                    node.content.forEach(scanForMarkers);
            };
            if (project.content)
                scanForMarkers(project.content);
            const hasAbstract = contentMarkers.has("abstract");
            const hasReferences = contentMarkers.has("references") ||
                contentMarkers.has("bibliography") ||
                contentMarkers.has("works cited") ||
                contentMarkers.has("force_bib_suppress");
            // 4b. Re-Evaluate Abstract Page (since we moved logic down to check content)
            // Note: We defined abstractParagraphs earlier (lines 149-170).
            // We should overwrite it if hasAbstract is true.
            if (hasAbstract && abstractParagraphs) {
                abstractParagraphs = undefined; // Suppress auto-generated abstract
                logger_1.default.info("Suppressing auto-abstract because document already has Abstract heading");
            }
            // 7. Generate references section (Conditional)
            const referencesParagraphs = [];
            // Use provided citations override or project's citations
            let citationsToUse = options.citations || project.citations || [];
            // Filter orphan references
            if (options.citationPolicy?.excludeOrphanReferences &&
                usedCitationIds.size > 0) {
                citationsToUse = citationsToUse.filter((c) => usedCitationIds.has(c.id));
            }
            // Only generate References if not already in document
            if (options.resolvedCitations?.bibliography &&
                options.resolvedCitations.bibliography.length > 0 &&
                !hasReferences) {
                referencesParagraphs.push(new docx_1.Paragraph({
                    text: "References",
                    heading: docx_1.HeadingLevel.HEADING_2,
                    spacing: { before: 400, after: 200 },
                    pageBreakBefore: true,
                }));
                options.resolvedCitations.bibliography.forEach((entry, index) => {
                    const children = [
                        new docx_1.BookmarkStart((index + 2000), `ref_${entry.id}`),
                        new docx_1.TextRun({
                            text: entry.text,
                        }),
                    ];
                    // Add DOI link if available
                    if (entry.doi) {
                        const doiUrl = entry.doi.startsWith("http")
                            ? entry.doi
                            : `https://doi.org/${entry.doi}`;
                        children.push(new docx_1.TextRun({ text: " " }));
                        children.push(new docx_1.ExternalHyperlink({
                            link: doiUrl,
                            children: [
                                new docx_1.TextRun({
                                    text: doiUrl,
                                    color: "0000FF",
                                    underline: {},
                                }),
                            ],
                        }));
                    }
                    else if (entry.url) {
                        children.push(new docx_1.TextRun({ text: " " }));
                        children.push(new docx_1.ExternalHyperlink({
                            link: entry.url,
                            children: [
                                new docx_1.TextRun({
                                    text: entry.url,
                                    color: "0000FF",
                                    underline: {},
                                }),
                            ],
                        }));
                    }
                    children.push(new docx_1.BookmarkEnd((index + 2000)));
                    referencesParagraphs.push(new docx_1.Paragraph({
                        children: children,
                        spacing: { after: 120, line: 360 },
                    }));
                });
            }
            else if (hasReferences) {
                logger_1.default.info("Suppressing auto-references because document already has References heading");
            }
            // 8. Merge all components
            // Clean up bodyParagraphs: Filter out truly empty paragraphs (heuristic: no text, no children)
            // If we have cover sections, the first paragraph of the body should start on a new page
            if (bodyParagraphs.length > 0 &&
                (coverPageParagraphs || abstractParagraphs || tocParagraphs)) {
                // Since we can't easily set pageBreakBefore on an existing Paragraph safely without knowing its concrete class,
                // we recreate the first paragraph with the flag if possible, or just insert it.
                // Actually, for headings and standard paragraphs, we can influence this during conversion.
                // But here we can just do:
                const firstPara = bodyParagraphs[0];
                if (firstPara instanceof docx_1.Paragraph) {
                    // Re-clone or just use the existing one if we can.
                    // In docx v9, you can't easily mutate options.
                    // So we'll just insert an empty paragraph WITH pageBreakBefore: true BEFORE the body
                    // IF the body doesn't already start with a break.
                    // BUT wait, that's what created the blank page before!
                    // CORRECT FIX: The mergeDocumentComponents handles the arrays.
                    // I will modify mergeDocumentComponents one last time to be even cleaner.
                }
            }
            const allParagraphs = publicationService_1.PublicationService.mergeDocumentComponents({
                coverPage: coverPageParagraphs,
                toc: tocParagraphs
                    ? abstractParagraphs
                        ? [...abstractParagraphs, ...tocParagraphs]
                        : tocParagraphs
                    : undefined,
                body: !options.includeTOC && abstractParagraphs
                    ? [...abstractParagraphs, ...bodyParagraphs]
                    : bodyParagraphs,
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
                            alignment: isIEEE ? docx_1.AlignmentType.JUSTIFIED : docx_1.AlignmentType.LEFT,
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
                            alignment: isIEEE ? docx_1.AlignmentType.CENTER : docx_1.AlignmentType.LEFT,
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
                            alignment: docx_1.AlignmentType.LEFT,
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
                            alignment: docx_1.AlignmentType.CENTER,
                            spacing: { after: 200 },
                        },
                    },
                ],
            };
            const doc = new docx_1.Document({
                styles: defaultStyles,
                features: {
                    updateFields: true,
                },
                comments: comments.length > 0 && !DEBUG_FLAGS.SKIP_COMMENTS
                    ? {
                        children: comments,
                    }
                    : undefined,
                sections: [
                    {
                        properties: {
                            page: {
                                size: {
                                    width: 11906, // A4 Width in twips (210mm)
                                    height: 16838, // A4 Height in twips (297mm)
                                },
                                margin: {
                                    top: 1440,
                                    right: 1440,
                                    bottom: 1440,
                                    left: 1440,
                                },
                                pageNumbers: {
                                    start: 1,
                                    formatType: "decimal",
                                },
                            },
                        },
                        headers: {
                            default: new docx_1.Header({
                                children: [
                                    new docx_1.Paragraph({
                                        children: [
                                            new docx_1.TextRun({
                                                text: options.metadata?.runningHead
                                                    ? `Running head: ${options.metadata.runningHead.toUpperCase()}`
                                                    : "",
                                            }),
                                            new docx_1.PositionalTab({
                                                alignment: "right",
                                                relativeTo: "margin",
                                                leader: "none",
                                            }),
                                            new docx_1.TextRun("Page "),
                                            new docx_1.TextRun({
                                                children: [docx_1.PageNumber.CURRENT],
                                            }),
                                        ],
                                    }),
                                ],
                            }),
                        },
                        children: allParagraphs,
                    },
                ],
            });
            // 10. Generate buffer
            const buffer = await docx_1.Packer.toBuffer(doc);
            const filename = `${project.title.replace(/\s+/g, "_")}_publication.docx`;
            // 10a. CRITICAL: Validate DOCX package structure for Word compatibility
            const validation = this.validateDOCXPackage(buffer);
            if (!validation.isValid) {
                logger_1.default.error("❌ DOCX package validation FAILED - Word will reject this file!", {
                    errors: validation.errors,
                    warnings: validation.warnings,
                });
                // Log each error for debugging
                validation.errors.forEach((error, i) => {
                    logger_1.default.error(`Validation Error ${i + 1}:`, { error });
                });
            }
            else {
                logger_1.default.info("✅ DOCX package validation PASSED - file should open in Word", {
                    warningCount: validation.warnings.length,
                });
            }
            logger_1.default.info("Publication-ready export complete", {
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
                mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                fileSize: buffer.length,
                auditResults: auditResults
                    ? {
                        isValid: auditResults.isValid,
                        issues: auditResults.issues,
                        warnings: auditResults.warnings,
                    }
                    : undefined,
            };
        }
        catch (error) {
            logger_1.default.error("Error in publication-ready export", {
                projectId,
                userId,
                error: error.message,
            });
            throw new Error(`Failed to export publication-ready document: ${error.message}`);
        }
    }
    /**
     * Sanitize text to remove invalid XML characters (CRITICAL for Word)
     * Removes control characters forbidden in XML 1.0 (0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F)
     */
    static sanitizeText(text) {
        if (!text)
            return "";
        return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    }
    /**
     * Validate and fetch image - CRITICAL for Word compatibility
     * This method validates images BEFORE creating ImageRun to prevent dangling relationships
     */
    static async validateAndFetchImage(src, attrs) {
        // --- DEBUG: USE PLACEHOLDER IMAGE ---
        if (DEBUG_FLAGS.USE_PLACEHOLDER_IMAGES) {
            // 1x1 JPEG (Safer than PNG for Word/DOCX compat)
            const base64 = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAQAAAAAAAAAAAAAAAAAAAAH/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwB/gA==";
            return {
                buffer: Buffer.from(base64, "base64"),
                format: "jpeg", // 🛑 CRITICAL FIX: Word demands "jpeg"
                dimensions: { width: 100, height: 100 },
            };
        }
        // Skip unsupported sources FIRST
        if (src.startsWith("blob:")) {
            logger_1.default.warn("Skipping blob URL in export - cannot resolve server-side", {
                src,
            });
            return null;
        }
        logger_1.default.debug("Validating and fetching image for DOCX export", { src });
        let data;
        // Fetch image data based on source type
        if (src.startsWith("data:")) {
            // Data URI - decode base64
            const matches = src.match(/^data:image\/([a-zA-Z+]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
                const base64Data = matches[2];
                data = Buffer.from(base64Data, "base64");
            }
        }
        else if (src.startsWith("http")) {
            // HTTP URL - fetch
            try {
                const response = await fetch(src, {
                    headers: { "User-Agent": "ColabWize-Export-Service" },
                });
                if (response.ok) {
                    const arrayBuffer = await response.arrayBuffer();
                    data = Buffer.from(arrayBuffer);
                }
                else {
                    logger_1.default.warn("Failed to fetch image", {
                        status: response.status,
                        src,
                    });
                    return null;
                }
            }
            catch (e) {
                logger_1.default.warn("Fetch failed", { error: e });
                return null;
            }
        }
        else {
            // Relative URL - convert to full URL
            const appUrl = await secrets_service_1.SecretsService.getAppUrl();
            const fullUrl = src.startsWith("/")
                ? `${appUrl}${src}`
                : `${appUrl}/${src}`;
            try {
                const response = await fetch(fullUrl);
                if (response.ok) {
                    const arrayBuffer = await response.arrayBuffer();
                    data = Buffer.from(arrayBuffer);
                }
                else {
                    logger_1.default.warn("Failed to fetch relative image", { fullUrl });
                    return null;
                }
            }
            catch (err) {
                logger_1.default.warn("Error fetching relative image URL", {
                    error: err,
                    fullUrl,
                });
                return null;
            }
        }
        // Validate data exists and has minimum size
        if (!data || data.length < 100) {
            logger_1.default.warn("Image data too small or empty", { size: data?.length || 0 });
            return null;
        }
        // --- MAGIC BYTE VALIDATION (CRITICAL for Word) ---
        let detectedType = null;
        // Check for PNG: 89 50 4E 47
        if (data[0] === 0x89 &&
            data[1] === 0x50 &&
            data[2] === 0x4e &&
            data[3] === 0x47) {
            detectedType = "png";
        }
        // Check for JPEG: FF D8 FF
        else if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
            detectedType = "jpg";
        }
        // Check for GIF: 47 49 46 38
        else if (data[0] === 0x47 &&
            data[1] === 0x49 &&
            data[2] === 0x46 &&
            data[3] === 0x38) {
            detectedType = "gif";
        }
        // Check for BMP: 42 4D
        else if (data[0] === 0x42 && data[1] === 0x4d) {
            detectedType = "bmp";
        }
        if (!detectedType) {
            logger_1.default.warn("Invalid or unsupported image format detected", {
                firstBytes: data.subarray(0, 8).toString("hex"),
                src,
            });
            return null;
        }
        // --- HTML/TEXT CHECK (Prevent 404 pages from being embedded) ---
        const snippet = data.subarray(0, 100).toString("utf8").toLowerCase();
        if (snippet.includes("<!doctype") ||
            snippet.includes("<html") ||
            snippet.includes("<body")) {
            logger_1.default.warn("Image buffer contains HTML/text, likely a 404 page. Skipping to prevent DOCX corruption.", { src });
            return null;
        }
        // Parse dimensions
        const parseDim = (val) => {
            const parsed = parseInt(String(val).replace("px", ""), 10);
            return isNaN(parsed) || parsed <= 0 ? null : parsed;
        };
        const userWidth = attrs?.width ? parseDim(attrs.width) : null;
        const userHeight = attrs?.height ? parseDim(attrs.height) : null;
        // ALL VALIDATION PASSED - return image data
        logger_1.default.debug("Image validated successfully", {
            format: detectedType,
            size: data.length,
            dimensions: { width: userWidth || 400, height: userHeight || 300 },
        });
        return {
            buffer: data,
            format: detectedType,
            dimensions: {
                width: userWidth || 400,
                height: userHeight || 300,
            },
        };
    }
    /**
     * Validate DOCX package structure (CRITICAL for Word compatibility)
     * Inspects the ZIP to check for structural issues that break Word
     */
    static validateDOCXPackage(buffer) {
        const errors = [];
        const warnings = [];
        try {
            const zip = new adm_zip_1.default(buffer);
            const entries = zip.getEntries();
            logger_1.default.debug("Validating DOCX package structure", {
                totalEntries: entries.length,
            });
            // 1. Check for required files
            const requiredFiles = [
                "word/document.xml",
                "[Content_Types].xml",
                "_rels/.rels",
            ];
            for (const file of requiredFiles) {
                const entry = zip.getEntry(file);
                if (!entry) {
                    errors.push(`Missing required file: ${file}`);
                }
            }
            // 2. Check for dangling relationships
            const relsEntry = zip.getEntry("word/_rels/document.xml.rels");
            if (relsEntry) {
                const relsXml = relsEntry.getData().toString("utf8");
                // Extract all Target attributes from relationships
                const relationshipMatches = relsXml.matchAll(/Target="([^"]+)"/g);
                for (const match of relationshipMatches) {
                    const target = match[1];
                    // Skip external  relationships (http://, mailto:, etc.)
                    if (target.startsWith("http://") ||
                        target.startsWith("https://") ||
                        target.startsWith("mailto:")) {
                        continue;
                    }
                    // Build the full path to check
                    const targetPath = target.startsWith("/")
                        ? target.substring(1)
                        : `word/${target}`;
                    // Check if target file exists in ZIP
                    const targetEntry = zip.getEntry(targetPath);
                    if (!targetEntry) {
                        errors.push(`Dangling relationship: ${target} → ${targetPath} does not exist in package`);
                    }
                }
            }
            // 3. Check media files are non-zero (skip directory entries)
            const mediaEntries = entries.filter((e) => e.entryName.startsWith("word/media/") && !e.isDirectory);
            for (const entry of mediaEntries) {
                if (entry.header.size === 0) {
                    errors.push(`Empty media file: ${entry.entryName}`);
                }
            }
            // 4. Check Content_Types.xml
            const contentTypesEntry = zip.getEntry("[Content_Types].xml");
            if (contentTypesEntry) {
                const contentTypesXml = contentTypesEntry.getData().toString("utf8");
                // Check that all media files have content type entries
                for (const mediaEntry of mediaEntries) {
                    const ext = mediaEntry.entryName.split(".").pop()?.toLowerCase();
                    if (ext && !contentTypesXml.includes(`Extension="${ext}"`)) {
                        warnings.push(`Media file ${mediaEntry.entryName} may not have content type registered`);
                    }
                }
            }
            logger_1.default.info("DOCX package validation complete", {
                isValid: errors.length === 0,
                errorCount: errors.length,
                warningCount: warnings.length,
            });
        }
        catch (error) {
            errors.push(`Failed to parse DOCX package: ${error.message}`);
        }
        return {
            isValid: errors.length === 0,
            errors,
            warnings,
        };
    }
    /**
     * Convert TipTap JSON to DOCX Paragraphs (enhanced version)
     */
    static async convertTipTapToDOCXParagraphs(content, citations = [], style = "apa", citationPolicy = {}, commentsRef = [], usedCitationIds = new Set(), state = { citationNodeIndex: 0 }, options = {}) {
        const paragraphs = [];
        if (!content || !content.content) {
            return paragraphs;
        }
        // DEBUG: Dump content to file for analysis
        try {
            const fs = require("fs");
            const path = require("path");
            const debugPath = path.join(process.cwd(), "debug_export.json");
            fs.writeFileSync(debugPath, JSON.stringify(content, null, 2));
        }
        catch (err) {
            logger_1.default.warn("Failed to dump debug export", err);
        }
        let isFirstNode = true;
        for (const node of content.content) {
            const shouldApplyPageBreak = isFirstNode && options.startOnNewPage;
            isFirstNode = false;
            // FIX: Strip empty paragraphs to prevent blank pages
            if (node.type === "paragraph") {
                const hasContent = node.content &&
                    node.content.some((c) => {
                        if (c.text && c.text.trim().length > 0)
                            return true;
                        if (c.type !== "text")
                            return true;
                        return false;
                    });
                if (!hasContent) {
                    continue;
                }
            }
            if (node.type === "paragraph") {
                const children = this.extractTextRunsFromNode(node, citations, style, citationPolicy, commentsRef, usedCitationIds, state, options);
                paragraphs.push(new docx_1.Paragraph({
                    children: children,
                    spacing: { line: 360, after: 140 }, // 1.5 line spacing + 7pt after
                    pageBreakBefore: shouldApplyPageBreak,
                }));
            }
            else if (node.type === "heading") {
                const children = this.extractTextRunsFromNode(node, citations, style, citationPolicy, commentsRef, usedCitationIds, state, options);
                const level = node.attrs?.level || 1;
                const headingLevels = {
                    1: docx_1.HeadingLevel.HEADING_1,
                    2: docx_1.HeadingLevel.HEADING_2,
                    3: docx_1.HeadingLevel.HEADING_3,
                    4: docx_1.HeadingLevel.HEADING_4,
                    5: docx_1.HeadingLevel.HEADING_5,
                    6: docx_1.HeadingLevel.HEADING_6,
                };
                paragraphs.push(new docx_1.Paragraph({
                    children: children,
                    heading: headingLevels[level] || docx_1.HeadingLevel.HEADING_1,
                    spacing: { before: 240, after: 200 }, // Add spacing before/after headings
                    pageBreakBefore: shouldApplyPageBreak,
                }));
            }
            else if (node.type === "bibliographyEntry") {
                const children = this.extractTextRunsFromNode(node, citations, style, citationPolicy, commentsRef, usedCitationIds, state, options);
                paragraphs.push(new docx_1.Paragraph({
                    children: children,
                    spacing: { line: 360, after: 120 },
                    indent: { left: 720, hanging: 720 }, // 0.5 inch hanging indent
                }));
            }
            else if (node.type === "bulletList" || node.type === "orderedList") {
                if (node.content) {
                    for (const listItem of node.content) {
                        if (listItem.content) {
                            for (const childNode of listItem.content) {
                                // Simplification: Assume list items contain paragraphs
                                if (childNode.type === "paragraph") {
                                    const children = this.extractTextRunsFromNode(childNode, citations, style, citationPolicy, commentsRef, usedCitationIds, state, options);
                                    paragraphs.push(new docx_1.Paragraph({
                                        children: children,
                                        bullet: { level: 0 }, // Simple bullet level
                                        spacing: { line: 360 },
                                    }));
                                }
                            }
                        }
                    }
                }
            }
            else if ((node.type === "image" || node.type === "imageExtension") &&
                node.attrs?.src) {
                // STRICT MODE: SKIP ALL IMAGES
                if (DEBUG_FLAGS.SKIP_IMAGES) {
                    logger_1.default.debug("DEBUG MODE: Skipping image node");
                    paragraphs.push(new docx_1.Paragraph({ text: "[IMAGE REMOVED IN DEBUG MODE]" }));
                    continue;
                }
                // CRITICAL: Validate image BEFORE creating ImageRun to prevent dangling relationships
                const validatedImage = await this.validateAndFetchImage(node.attrs.src, node.attrs);
                if (validatedImage === null) {
                    // Image validation failed - don't create paragraph or ImageRun at all
                    // This prevents dangling relationships in the DOCX package
                    logger_1.default.debug("Image validation failed, skipping image node entirely");
                    continue;
                }
                // Image is valid - create ImageRun (relationship will be created here)
                paragraphs.push(new docx_1.Paragraph({
                    children: [
                        new docx_1.ImageRun({
                            data: validatedImage.buffer,
                            transformation: validatedImage.dimensions,
                            type: validatedImage.format === "jpg"
                                ? "jpeg"
                                : validatedImage.format, // 🛑 CRITICAL FIX
                            // altText: node.attrs.alt || "Image", // REMOVED for safety
                        }),
                    ],
                    spacing: { before: 240, after: 240 },
                    alignment: node.attrs.align === "center"
                        ? docx_1.AlignmentType.CENTER
                        : node.attrs.align === "right"
                            ? docx_1.AlignmentType.RIGHT
                            : docx_1.AlignmentType.LEFT,
                }));
            }
            else if ((node.type === "columns" || node.type === "columnLayout") &&
                !citationPolicy?.wordSafeMode) {
                // STRICT MODE: SKIP COLUMNS
                if (DEBUG_FLAGS.SKIP_COLUMNS) {
                    // SAFETY FALLBACK: Even if columns are disabled, output their CONTENT linearly
                    // This prevents "blank document" issues when users have content inside column wrappers
                    if (node.content && node.content.length > 0) {
                        logger_1.default.info("Processing column content linearly (Layout Disabled)");
                        // Iterate through children (columns or blocks) and extract content
                        for (const child of node.content) {
                            if (child.type === "column") {
                                // If nested column structure, unwrap content
                                const columnContent = await this.convertTipTapToDOCXParagraphs(child, citations, style, citationPolicy, commentsRef, usedCitationIds, state, options);
                                paragraphs.push(...columnContent);
                            }
                            else {
                                // If flat content, just process it
                                const itemContent = await this.convertTipTapToDOCXParagraphs({ content: [child] }, citations, style, citationPolicy, commentsRef, usedCitationIds, state, options);
                                paragraphs.push(...itemContent);
                            }
                        }
                    }
                    continue;
                }
                // Handle multi-column layout (DISABLED IN WORD-SAFE MODE)
                const numColumns = parseInt(node.attrs?.columns || "2", 10);
                if (node.content && node.content.length > 0) {
                    const tableRows = [];
                    const isNestedStructure = node.content.some((c) => c.type === "column");
                    if (isNestedStructure) {
                        // Old nested logic
                        const columnCells = [];
                        for (const column of node.content) {
                            if (column.type === "column") {
                                const columnParagraphs = await this.convertTipTapToDOCXParagraphs(column, citations, style, citationPolicy, commentsRef, usedCitationIds, state);
                                columnCells.push(new docx_1.TableCell({
                                    children: columnParagraphs.length > 0
                                        ? columnParagraphs
                                        : [new docx_1.Paragraph({ text: "" })],
                                    borders: {
                                        top: { style: "none" },
                                        bottom: { style: "none" },
                                        left: { style: "none" },
                                        right: { style: "none" },
                                    },
                                    width: {
                                        size: Math.floor(5000 / numColumns),
                                        type: docx_1.WidthType.PERCENTAGE,
                                    },
                                    verticalAlign: docx_1.VerticalAlign.TOP,
                                }));
                            }
                        }
                        if (columnCells.length > 0) {
                            tableRows.push(new docx_1.TableRow({ children: columnCells }));
                        }
                    }
                    else {
                        // Flat Grid Logic
                        const items = node.content;
                        const colWidth = Math.floor(5000 / numColumns);
                        let currentRowCells = [];
                        for (let i = 0; i < items.length; i++) {
                            const item = items[i];
                            const cellParagraphs = await this.convertTipTapToDOCXParagraphs({ content: [item] }, citations, style, citationPolicy, commentsRef, undefined, state, options);
                            currentRowCells.push(new docx_1.TableCell({
                                children: cellParagraphs.length > 0
                                    ? cellParagraphs
                                    : [new docx_1.Paragraph({ text: "" })],
                                borders: {
                                    top: { style: "none" },
                                    bottom: { style: "none" },
                                    left: { style: "none" },
                                    right: { style: "none" },
                                },
                                width: { size: colWidth, type: docx_1.WidthType.PERCENTAGE },
                                verticalAlign: docx_1.VerticalAlign.TOP,
                            }));
                            if (currentRowCells.length === numColumns) {
                                tableRows.push(new docx_1.TableRow({ children: currentRowCells }));
                                currentRowCells = [];
                            }
                        }
                        if (currentRowCells.length > 0) {
                            while (currentRowCells.length < numColumns) {
                                currentRowCells.push(new docx_1.TableCell({
                                    children: [new docx_1.Paragraph({ text: "" })],
                                    borders: {
                                        top: { style: "none" },
                                        bottom: { style: "none" },
                                        left: { style: "none" },
                                        right: { style: "none" },
                                    },
                                    width: { size: colWidth, type: docx_1.WidthType.PERCENTAGE },
                                }));
                            }
                            tableRows.push(new docx_1.TableRow({ children: currentRowCells }));
                        }
                    }
                    if (tableRows.length > 0) {
                        paragraphs.push(new docx_1.Table({
                            rows: tableRows,
                            width: { size: 5000, type: docx_1.WidthType.PERCENTAGE },
                            borders: {
                                top: { style: docx_1.BorderStyle.NONE },
                                bottom: { style: docx_1.BorderStyle.NONE },
                                left: { style: docx_1.BorderStyle.NONE },
                                right: { style: docx_1.BorderStyle.NONE },
                                insideHorizontal: { style: docx_1.BorderStyle.NONE },
                                insideVertical: { style: docx_1.BorderStyle.NONE },
                            },
                        }));
                    }
                }
            }
            else if (node.type === "table") {
                // STRICT MODE: SKIP TABLES
                if (DEBUG_FLAGS.SKIP_TABLES) {
                    logger_1.default.debug("DEBUG MODE: Skipping table node");
                    paragraphs.push(new docx_1.Paragraph({ text: "[TABLE REMOVED IN DEBUG MODE]" }));
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
                                        ? cell.content.map((p) => {
                                            if (p.type === "paragraph") {
                                                const children = this.extractTextRunsFromNode(p, citations, style, citationPolicy, commentsRef, usedCitationIds, state);
                                                return new docx_1.Paragraph({
                                                    children: children,
                                                    alignment: isHeader
                                                        ? docx_1.AlignmentType.CENTER
                                                        : docx_1.AlignmentType.LEFT,
                                                });
                                            }
                                            return new docx_1.Paragraph({ text: "" });
                                        })
                                        : [new docx_1.Paragraph({ text: "" })];
                                    cells.push(new docx_1.TableCell({
                                        children: cellParagraphs,
                                        width: {
                                            size: cellWidth,
                                            type: docx_1.WidthType.PERCENTAGE,
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
                                        verticalAlign: docx_1.VerticalAlign.CENTER,
                                    }));
                                }
                            }
                            if (cells.length > 0) {
                                tableRows.push(new docx_1.TableRow({ children: cells }));
                            }
                        }
                    }
                }
                if (tableRows.length > 0) {
                    paragraphs.push(new docx_1.Table({
                        rows: tableRows,
                        style: "TableGrid",
                        width: {
                            size: 5000,
                            type: docx_1.WidthType.PERCENTAGE,
                        },
                    }));
                }
            }
            else if (node.type === "figure") {
                // Handle figure (container)
                const figureParagraphs = await this.convertTipTapToDOCXParagraphs(node, citations, style, citationPolicy, commentsRef, usedCitationIds, state, options);
                paragraphs.push(...figureParagraphs);
            }
            else if (node.type === "figcaption") {
                // Handle figcaption
                const children = this.extractTextRunsFromNode(node, citations, style, citationPolicy, commentsRef, usedCitationIds, state);
                paragraphs.push(new docx_1.Paragraph({
                    children: children,
                    alignment: docx_1.AlignmentType.CENTER,
                    spacing: { before: 100, after: 200 },
                    style: "Caption", // Assuming standard Word style or we can set italics manually
                }));
            }
            else {
                // Fallback for unknown node types or debugging
                logger_1.default.debug("Unknown or unhandled node type in DOCX export", {
                    type: node.type,
                });
            }
        }
        return paragraphs;
    }
    /**
     * Extract styled TextRuns from a TipTap node
     */
    static extractTextRunsFromNode(node, citations = [], style = "apa", citationPolicy, commentsRef = [], usedCitationIds, state = { citationNodeIndex: 0 }, options = {}) {
        const runs = [];
        // Check for violations in this node context
        let violationCommentId = null;
        // If citationPolicy.markUnsupportedClaims is true and we have violations:
        // (Citation audit comments removed per user request)
        if (node.content) {
            node.content.forEach((child) => {
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
                    parts.forEach((part, index) => {
                        if (index > 0) {
                            // Insert break for newline
                            runs.push(new docx_1.TextRun({ text: "", break: 1 }));
                        }
                        if (part) {
                            const options = {
                                text: part,
                                size: 24, // 24 half-points = 12pt
                            };
                            if (child.marks) {
                                child.marks.forEach((mark) => {
                                    if (mark.type === "bold")
                                        options.bold = true;
                                    if (mark.type === "italic")
                                        options.italics = true;
                                    if (mark.type === "underline")
                                        options.underline = {};
                                    if (mark.type === "strike")
                                        options.strike = true;
                                });
                            }
                            runs.push(new docx_1.TextRun(options));
                        }
                    });
                }
                else if (child.HardBreak) {
                    // Keep hardBreak compatible
                    runs.push(new docx_1.TextRun({ text: "", break: 1 }));
                }
                else if (child.type === "hardBreak") {
                    runs.push(new docx_1.TextRun({ text: "", break: 1 }));
                }
                else if (child.type === "citation") {
                    const citationId = child.attrs?.citationId;
                    const fallback = PublicationExportService.sanitizeText(child.attrs?.fallback || "[Citation]");
                    if (options?.resolvedCitations) {
                        const resolved = options.resolvedCitations.occurrenceMap.get(state.citationNodeIndex);
                        state.citationNodeIndex++;
                        if (resolved !== undefined) {
                            if (resolved.text) {
                                const doiUrl = resolved.doi
                                    ? resolved.doi.startsWith("http")
                                        ? resolved.doi
                                        : `https://doi.org/${resolved.doi}`
                                    : null;
                                const url = resolved.url || doiUrl;
                                if (url) {
                                    runs.push(new docx_1.ExternalHyperlink({
                                        link: url,
                                        children: [
                                            new docx_1.TextRun({
                                                text: resolved.text,
                                                size: 24,
                                                color: "2563EB",
                                                underline: {},
                                            }),
                                        ],
                                    }));
                                }
                                else if (citationId) {
                                    runs.push(new docx_1.InternalHyperlink({
                                        anchor: `ref_${citationId}`,
                                        children: [
                                            new docx_1.TextRun({
                                                text: resolved.text,
                                                size: 24,
                                                color: "2563EB",
                                                underline: {},
                                            }),
                                        ],
                                    }));
                                }
                                else {
                                    runs.push(new docx_1.TextRun({ text: resolved.text, size: 24 }));
                                }
                            }
                        }
                        else {
                            runs.push(new docx_1.TextRun({ text: fallback, color: "FF0000", size: 24 }));
                        }
                    }
                    else {
                        if (citationId && citations.length > 0) {
                            if (usedCitationIds)
                                usedCitationIds.add(citationId);
                            const citationData = citations.find((c) => c.id === citationId);
                            if (citationData) {
                                const inText = this.formatInTextCitation(citationData, style);
                                runs.push(new docx_1.InternalHyperlink({
                                    anchor: `ref_${citationId}`,
                                    children: [
                                        new docx_1.TextRun({
                                            text: inText,
                                            size: 24,
                                            color: "2563EB",
                                            underline: {},
                                            bold: child.marks?.some((m) => m.type === "bold"),
                                            italics: child.marks?.some((m) => m.type === "italic"),
                                        }),
                                    ],
                                }));
                            }
                            else {
                                runs.push(new docx_1.TextRun({ text: fallback, color: "FF0000", size: 24 }));
                            }
                        }
                        else {
                            runs.push(new docx_1.TextRun({ text: fallback, size: 24 }));
                            state.citationNodeIndex++;
                        }
                    }
                }
            });
        }
        return runs;
    }
    /**
     * Format in-text citation (e.g., "(Smith, 2023)")
     */
    static formatInTextCitation(citation, style) {
        const authors = Array.isArray(citation.authors)
            ? citation.authors
            : [citation.author || "Unknown"];
        const year = citation.year || "n.d.";
        // Get last name of first author
        const firstAuthor = authors[0] || "Unknown";
        let authorText = typeof firstAuthor === "string"
            ? firstAuthor
            : firstAuthor.lastName || firstAuthor.firstName || "Unknown";
        if (authors.length > 2) {
            authorText += " et al.";
        }
        else if (authors.length === 2) {
            const secondAuthor = authors[1];
            const secondAuthorText = typeof secondAuthor === "string"
                ? secondAuthor
                : secondAuthor.lastName || "Unknown";
            authorText += ` & ${secondAuthorText}`;
        }
        if (style === "apa") {
            return `(${authorText}, ${year})`;
        }
        else if (style === "mla") {
            return `(${authorText})`;
        }
        else if (style === "ieee") {
            // In a real IEEE export, we would need the citation index.
            // For now, let's use the author/year format as a readable placeholder until we implement ordering.
            return `[${authorText}, ${year}]`;
        }
        return `(${authorText}, ${year})`;
    }
    /**
     * Format citation in specified style
     */
    static formatCitation(citation, style) {
        // Basic citation formatting
        const authors = citation.authors || citation.author || "Unknown";
        const title = citation.title || "Untitled";
        const year = citation.year || "n.d.";
        if (style === "apa") {
            return `${authors} (${year}). ${title}.`;
        }
        else if (style === "mla") {
            return `${authors}. "${title}." ${year}.`;
        }
        else {
            // Chicago
            return `${authors}. ${title}. ${year}.`;
        }
    }
}
exports.PublicationExportService = PublicationExportService;
