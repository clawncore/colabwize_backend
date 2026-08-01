"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicationService = void 0;
const logger_1 = __importDefault(require("../monitoring/logger"));
const docx_1 = require("docx");
class PublicationService {
    /**
     * Generate APA 7th Edition compliant cover page
     */
    static generateAPACoverPage(metadata) {
        const coverPage = [];
        // Running head (top of page, max 50 characters)
        const runningHead = metadata.runningHead ||
            (metadata.title ? metadata.title.substring(0, 50).toUpperCase() : "");
        coverPage.push(new docx_1.Paragraph({
            text: runningHead,
            alignment: docx_1.AlignmentType.LEFT,
            spacing: { after: 200 },
            style: "Normal",
        }));
        // Vertical centering (add spacing)
        for (let i = 0; i < 8; i++) {
            coverPage.push(new docx_1.Paragraph({ text: "" }));
        }
        // Title (bold, centered)
        coverPage.push(new docx_1.Paragraph({
            children: [
                new docx_1.TextRun({
                    text: metadata.title,
                    bold: true,
                    size: 28, // 14pt
                }),
            ],
            alignment: docx_1.AlignmentType.CENTER,
            spacing: { after: 400 },
        }));
        // Author name
        if (metadata.author) {
            coverPage.push(new docx_1.Paragraph({
                text: metadata.author,
                alignment: docx_1.AlignmentType.CENTER,
                spacing: { after: 200 },
            }));
        }
        // Institution/Course/Instructor
        const affiliationLines = [];
        if (metadata.institution)
            affiliationLines.push(metadata.institution);
        if (metadata.course)
            affiliationLines.push(metadata.course);
        if (metadata.instructor)
            affiliationLines.push(metadata.instructor);
        affiliationLines.forEach((line) => {
            coverPage.push(new docx_1.Paragraph({
                text: line,
                alignment: docx_1.AlignmentType.CENTER,
                spacing: { after: 100 },
            }));
        });
        // Date
        coverPage.push(new docx_1.Paragraph({
            text: metadata.date ||
                new Date().toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                }),
            alignment: docx_1.AlignmentType.CENTER,
            spacing: { before: 400 },
        }));
        return coverPage;
    }
    /**
     * Generate MLA 8th Edition compliant cover page
     */
    static generateMLACoverPage(metadata) {
        const coverPage = [];
        // MLA format: upper-left corner, double-spaced
        const headerLines = [];
        if (metadata.author)
            headerLines.push(metadata.author);
        if (metadata.instructor)
            headerLines.push(metadata.instructor);
        if (metadata.course)
            headerLines.push(metadata.course);
        headerLines.push(metadata.date ||
            new Date().toLocaleDateString("en-US", {
                day: "numeric",
                month: "long",
                year: "numeric",
            }));
        headerLines.forEach((line) => {
            coverPage.push(new docx_1.Paragraph({
                text: line,
                alignment: docx_1.AlignmentType.LEFT,
                spacing: { after: 200 }, // Double-spacing
            }));
        });
        // Title (centered)
        coverPage.push(new docx_1.Paragraph({
            text: metadata.title,
            alignment: docx_1.AlignmentType.CENTER,
            spacing: { before: 200, after: 200 },
        }));
        return coverPage;
    }
    /**
     * Extract Table of Contents from TipTap JSON content
     */
    static extractTOC(content) {
        const headings = [];
        const stack = [];
        const processNode = (node) => {
            if (node.type === "heading") {
                const level = node.attrs?.level || 1;
                let headingText = "";
                // Extract text from heading content
                if (node.content) {
                    node.content.forEach((child) => {
                        if (child.type === "text") {
                            headingText += child.text || "";
                        }
                    });
                }
                const headingNode = {
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
                }
                else {
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
    static generateTOCParagraphs(headings, level = 0) {
        const tocParagraphs = [];
        headings.forEach((heading) => {
            const indent = level * 400; // Indent based on level
            const dotLeader = ".".repeat(Math.max(50 - heading.text.length - indent / 50, 3));
            tocParagraphs.push(new docx_1.Paragraph({
                text: `${heading.text}${dotLeader}${heading.pageNumber || "?"}`,
                indent: { left: indent },
                spacing: { after: 100 },
            }));
            // Recursively add children
            if (heading.children.length > 0) {
                tocParagraphs.push(...this.generateTOCParagraphs(heading.children, level + 1));
            }
        });
        return tocParagraphs;
    }
    /**
     * Perform structural fidelity audit on document
     */
    static performStructuralAudit(content, title, wordCount, minWordCount = 0) {
        const issues = [];
        const warnings = [];
        // Check for title
        const hasTitle = !!(title && title.trim().length > 0);
        if (!hasTitle) {
            issues.push("Document missing title");
        }
        // Extract and validate heading structure
        const headings = this.extractTOC(content);
        const headingCount = this.countHeadings(headings);
        if (headingCount === 0) {
            warnings.push("No headings found - consider adding section headers for better structure");
        }
        // Check for proper heading hierarchy
        const hierarchyIssues = this.validateHeadingHierarchy(headings);
        issues.push(...hierarchyIssues);
        // Check word count
        const minWordCountMet = wordCount >= minWordCount;
        if (!minWordCountMet && minWordCount > 0) {
            issues.push(`Word count (${wordCount}) below minimum requirement (${minWordCount})`);
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
    static validateHeadingHierarchy(headings, expectedLevel = 1) {
        const issues = [];
        headings.forEach((heading) => {
            if (heading.level > expectedLevel + 1) {
                issues.push(`Heading hierarchy issue: "${heading.text}" skips from H${expectedLevel} to H${heading.level}`);
            }
            // Recursively check children
            if (heading.children.length > 0) {
                issues.push(...this.validateHeadingHierarchy(heading.children, heading.level));
            }
        });
        return issues;
    }
    /**
     * Count total headings recursively
     */
    static countHeadings(headings) {
        let count = headings.length;
        headings.forEach((heading) => {
            count += this.countHeadings(heading.children);
        });
        return count;
    }
    /**
     * Merge document components (Cover + TOC + Body + References)
     */
    /**
     * Merge document components (Cover + TOC + Body + References)
     */
    static mergeDocumentComponents(components) {
        const merged = [];
        // Helper to add page break to the first paragraph of a component
        const ensurePageBreak = (component) => {
            if (component && component.length > 0) {
                const first = component[0];
                // If it's a paragraph, we can set pageBreakBefore
                if (first instanceof docx_1.Paragraph) {
                    // We can't easily mutate the private properties of Paragraph,
                    // so we wrap it or trust that the caller has already set it
                    // Actually, in docx library, it's better to just ensure the components
                    // are generated with pageBreakBefore: true on their headers.
                }
            }
        };
        // Add cover page (Cover page should not have page break before itself usually, unless it's not first)
        if (components.coverPage) {
            merged.push(...components.coverPage);
        }
        // Add TOC
        if (components.toc && components.toc.length > 0) {
            merged.push(...components.toc);
        }
        // Add body content
        merged.push(...components.body);
        // Add references
        if (components.references && components.references.length > 0) {
            merged.push(...components.references);
        }
        return merged;
    }
    /**
     * Get user metadata from database for cover page
     */
    static async getUserMetadata(userId) {
        try {
            const { prisma } = await import("../lib/prisma.js");
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
        }
        catch (error) {
            logger_1.default.error("Error fetching user metadata:", error);
            return {};
        }
    }
}
exports.PublicationService = PublicationService;
