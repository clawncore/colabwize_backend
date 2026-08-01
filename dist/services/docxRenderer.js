"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocxRenderer = void 0;
const cheerio = __importStar(require("cheerio"));
const docx_1 = require("docx");
class DocxRenderer {
    /**
     * Converts HTML content and bibliography into DOCX Paragraphs.
     *
     * @param html The editor HTML content with injected hyperlinks.
     * @param bibEntries Validated bibliography entries with IDs (from CitationEngine).
     * @param style 'apa' or 'ieee' (affects font/size if we were doing full document, but here mainly for context).
     */
    static async render(html, bibEntries, style = 'apa') {
        const paragraphs = [];
        const $ = cheerio.load(html);
        // 1. Process Body Content
        // We iterate over top-level elements (p, h1, etc.)
        const bodyNodes = $('body').children();
        bodyNodes.each((i, el) => {
            const p = this.processBlockElement($, el);
            if (p)
                paragraphs.push(p);
        });
        // 2. Process Bibliography
        if (bibEntries && bibEntries.length > 0) {
            // Add Header
            paragraphs.push(new docx_1.Paragraph({
                text: "References",
                heading: docx_1.HeadingLevel.HEADING_1,
                pageBreakBefore: true
            }));
            // Process each entry
            for (const entry of bibEntries) {
                // entry.text is HTML wrapped in <div id="ref_KEY">...</div>
                // We parse it to extract text and wrap in Bookmark
                const $bib = cheerio.load(entry.text);
                const div = $bib('div').first();
                const id = div.attr('id') || entry.id;
                const textContent = div.text().trim(); // Basic text extraction for now, or parse children if rich text
                // Create Bookmark around the paragraph
                // Note: docx Bookmarks are usually around runs or whole paragraphs.
                // We will wrap the whole paragraph content.
                // BookmarkStart/End require a unique ID (number) and a name (string) in some docx versions.
                // We generate a unique ID based on the loop index or hash.
                // Fix: ensure ID is number.
                const bookmarkId = bibEntries.indexOf(entry) + 1000; // Offset to avoid collisions
                paragraphs.push(new docx_1.Paragraph({
                    children: [
                        new docx_1.BookmarkStart(bookmarkId, id),
                        new docx_1.TextRun({ text: textContent }),
                        new docx_1.BookmarkEnd(bookmarkId)
                    ],
                    spacing: { after: 120 }
                }));
            }
        }
        return paragraphs;
    }
    static processBlockElement($, el) {
        const tag = $(el).prop('tagName')?.toLowerCase();
        // Call the improved recursive processor
        const children = this.processNodesWithStyle($, $(el).contents(), {});
        // Construct formatting options
        let heading = undefined;
        if (tag) {
            switch (tag) {
                case 'h1':
                    heading = docx_1.HeadingLevel.HEADING_1;
                    break;
                case 'h2':
                    heading = docx_1.HeadingLevel.HEADING_2;
                    break;
                case 'h3':
                    heading = docx_1.HeadingLevel.HEADING_3;
                    break;
                case 'h4':
                    heading = docx_1.HeadingLevel.HEADING_4;
                    break;
                case 'p':
                    // standard paragraph
                    break;
            }
        }
        return new docx_1.Paragraph({
            children,
            heading
        });
    }
    // Improved inline processor that handles nesting
    static processNodesWithStyle($, nodes, style) {
        const elements = [];
        nodes.each((i, el) => {
            if (el.type === 'text') {
                const text = $(el).text();
                // Avoid empty text runs unless significant
                if (text) {
                    elements.push(new docx_1.TextRun({
                        text: text,
                        bold: style.bold,
                        italics: style.italics,
                        underline: style.underline ? {} : undefined,
                    }));
                }
            }
            else if (el.type === 'tag') {
                const tag = $(el).prop('tagName')?.toLowerCase();
                if (tag === 'a') {
                    // Hyperlink
                    const href = $(el).attr('href') || '#';
                    // Recurse with same style
                    const children = this.processNodesWithStyle($, $(el).contents(), style);
                    const textRuns = children.filter(c => c instanceof docx_1.TextRun);
                    if (href.startsWith('#')) {
                        // Internal Link
                        // Note: InternalHyperlink anchor usually refers to a bookmark name.
                        elements.push(new docx_1.InternalHyperlink({
                            anchor: href.substring(1),
                            children: textRuns,
                            // docx adds implicit styling (Hyperlink style) usually.
                        }));
                    }
                    else {
                        // External Link
                        elements.push(new docx_1.ExternalHyperlink({
                            link: href,
                            children: textRuns
                        }));
                    }
                }
                else if (tag === 'br') {
                    // Hard break
                    elements.push(new docx_1.TextRun({ text: "", break: 1 }));
                }
                else {
                    // Formatting
                    const newStyle = { ...style };
                    if (tag === 'b' || tag === 'strong')
                        newStyle.bold = true;
                    if (tag === 'i' || tag === 'em')
                        newStyle.italics = true;
                    if (tag === 'u')
                        newStyle.underline = true;
                    elements.push(...this.processNodesWithStyle($, $(el).contents(), newStyle));
                }
            }
        });
        return elements;
    }
}
exports.DocxRenderer = DocxRenderer;
