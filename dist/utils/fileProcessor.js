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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.processFileContent = processFileContent;
exports.base64ToBuffer = base64ToBuffer;
exports.bufferToBase64 = bufferToBase64;
const logger_1 = __importDefault(require("../monitoring/logger"));
const mammoth = __importStar(require("mammoth"));
// Use the version of generateJSON compatible with Tiptap v2
const html_1 = require("@tiptap/html");
// Import available extensions to preserve more formatting
const extension_document_1 = __importDefault(require("@tiptap/extension-document"));
const extension_paragraph_1 = __importDefault(require("@tiptap/extension-paragraph"));
const extension_text_1 = __importDefault(require("@tiptap/extension-text"));
const extension_bold_1 = __importDefault(require("@tiptap/extension-bold"));
const extension_italic_1 = __importDefault(require("@tiptap/extension-italic"));
const extension_underline_1 = __importDefault(require("@tiptap/extension-underline"));
const extension_strike_1 = __importDefault(require("@tiptap/extension-strike"));
const extension_code_1 = __importDefault(require("@tiptap/extension-code"));
const extension_heading_1 = __importDefault(require("@tiptap/extension-heading"));
const extension_bullet_list_1 = __importDefault(require("@tiptap/extension-bullet-list"));
const extension_ordered_list_1 = __importDefault(require("@tiptap/extension-ordered-list"));
const extension_list_item_1 = __importDefault(require("@tiptap/extension-list-item"));
const extension_blockquote_1 = __importDefault(require("@tiptap/extension-blockquote"));
const extension_horizontal_rule_1 = __importDefault(require("@tiptap/extension-horizontal-rule"));
const extension_link_1 = __importDefault(require("@tiptap/extension-link"));
const CalloutBlockExtension_1 = require("../extensions/CalloutBlockExtension");
const QuoteBlockExtension_1 = require("../extensions/QuoteBlockExtension");
const PricingTableExtension_1 = require("../extensions/PricingTableExtension");
const VisualElementExtension_1 = require("../extensions/VisualElementExtension");
const AuthorBlockExtension_1 = require("../extensions/AuthorBlockExtension");
const AuthorExtension_1 = require("../extensions/AuthorExtension");
const SectionExtension_1 = require("../extensions/SectionExtension");
const KeywordsExtension_1 = require("../extensions/KeywordsExtension");
const CustomCodeBlockExtension_1 = require("../extensions/CustomCodeBlockExtension");
const FigureExtension_1 = require("../extensions/FigureExtension");
const ListExtension_1 = require("../extensions/ListExtension");
const CoverPageExtension_1 = require("../extensions/CoverPageExtension");
// Define the extensions array for reuse with richer formatting support
const tipTapExtensions = [
    extension_document_1.default,
    extension_paragraph_1.default,
    extension_text_1.default,
    extension_bold_1.default,
    extension_italic_1.default,
    extension_underline_1.default,
    extension_strike_1.default,
    extension_code_1.default,
    extension_heading_1.default,
    extension_bullet_list_1.default,
    extension_ordered_list_1.default,
    extension_list_item_1.default,
    extension_blockquote_1.default,
    extension_horizontal_rule_1.default,
    extension_link_1.default,
    CalloutBlockExtension_1.CalloutBlockExtension,
    QuoteBlockExtension_1.QuoteBlockExtension,
    PricingTableExtension_1.PricingTableExtension,
    VisualElementExtension_1.VisualElementExtension,
    AuthorBlockExtension_1.AuthorBlockExtension,
    AuthorExtension_1.AuthorExtension,
    SectionExtension_1.SectionExtension,
    KeywordsExtension_1.KeywordsExtension,
    CustomCodeBlockExtension_1.CustomCodeBlockExtension,
    FigureExtension_1.FigureExtension,
    ListExtension_1.ListExtension,
    CoverPageExtension_1.CoverPageExtension,
];
/**
 * Process different file types and extract formatted content
 * @param fileData Base64 encoded file content
 * @param fileType MIME type of the file
 * @returns Promise<{ content: any; wordCount: number }> Extracted formatted content and word count
 */
async function processFileContent(fileData, fileType) {
    try {
        let content = "";
        let wordCount = 0;
        switch (fileType) {
            case "text/plain":
                content = fileData;
                wordCount = content.trim().split(/\s+/).length;
                // Convert plain text to Tiptap JSON format
                content = (0, html_1.generateJSON)(content, tipTapExtensions);
                break;
            case "application/msword":
            case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                // For DOC and DOCX files, convert base64 to buffer and process with mammoth
                const docBuffer = Buffer.from(fileData, "base64");
                if (fileType === "application/msword") {
                    // For .doc files, we need to convert them to .docx first or use a different approach
                    // For now, we'll just store the base64 content
                    content = fileData;
                    wordCount = 0; // Will be calculated when opened in editor
                    // Return as plain text for .doc files
                    content = {
                        type: "doc",
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        text: "Content from .doc file - formatting preservation not supported for this file type",
                                    },
                                ],
                            },
                        ],
                    };
                }
                else {
                    // For .docx files, use mammoth to convert to HTML and then to Tiptap JSON
                    try {
                        const result = await mammoth.convertToHtml({ buffer: docBuffer });
                        const htmlContent = result.value;
                        // Convert HTML to Tiptap JSON format
                        content = (0, html_1.generateJSON)(htmlContent, tipTapExtensions);
                        // Calculate word count from the HTML text content by stripping HTML tags
                        const strippedText = htmlContent
                            .replace(/<[^>]*>/g, " ")
                            .replace(/\s+/g, " ")
                            .trim();
                        wordCount = strippedText
                            .split(/\s+/)
                            .filter((word) => word.length > 0).length;
                    }
                    catch (docxError) {
                        logger_1.default.warn("Failed to process DOCX file with mammoth, storing as base64", docxError);
                        content = fileData;
                        wordCount = 0; // Will be calculated when opened in editor
                        // Fallback to plain text conversion
                        content = {
                            type: "doc",
                            content: [
                                {
                                    type: "paragraph",
                                    content: [
                                        {
                                            type: "text",
                                            text: "Content from .docx file - formatting preservation failed during import",
                                        },
                                    ],
                                },
                            ],
                        };
                    }
                }
                break;
            case "application/pdf":
                // For PDF files, convert base64 to buffer and process with pdf-parse
                try {
                    logger_1.default.debug("Starting PDF processing");
                    const pdfBuffer = Buffer.from(fileData, "base64");
                    logger_1.default.debug("PDF buffer created, length:", pdfBuffer.length);
                    // Dynamically import pdf-parse (the correct version)
                    // @ts-ignore
                    const pdfParse = (await import("pdf-parse")).default;
                    logger_1.default.debug("pdf-parse imported successfully");
                    const pdfData = await pdfParse(pdfBuffer);
                    logger_1.default.debug("PDF parsed successfully, text length:", pdfData.text.length);
                    const pdfText = pdfData.text;
                    // Convert plain text to Tiptap JSON format
                    content = (0, html_1.generateJSON)(pdfText, tipTapExtensions);
                    wordCount = pdfText.trim().split(/\s+/).length;
                    logger_1.default.debug("PDF processing completed successfully");
                }
                catch (pdfError) {
                    logger_1.default.warn("Failed to process PDF file with pdf-parse, storing as base64", {
                        error: pdfError.message || pdfError,
                        stack: pdfError.stack,
                        fileDataLength: fileData?.length || 0,
                    });
                    content = fileData;
                    wordCount = 0; // Will be calculated when opened in editor
                    // Fallback to plain text conversion
                    content = {
                        type: "doc",
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        text: "Content from PDF file - text extraction failed during import",
                                    },
                                ],
                            },
                        ],
                    };
                }
                break;
            default:
                content = fileData;
                wordCount = content.trim().split(/\s+/).length;
                // Convert plain text to Tiptap JSON format
                content = (0, html_1.generateJSON)(content, tipTapExtensions);
                break;
        }
        return { content, wordCount };
    }
    catch (error) {
        logger_1.default.error("Error processing file content:", {
            error: error.message || error,
            stack: error.stack,
            fileType,
        });
        // Return fallback content if processing fails
        return {
            content: {
                type: "doc",
                content: [
                    {
                        type: "paragraph",
                        content: [
                            {
                                type: "text",
                                text: "Error processing document content during import",
                            },
                        ],
                    },
                ],
            },
            wordCount: 0,
        };
    }
}
/**
 * Convert base64 string to buffer
 * @param base64String Base64 encoded string
 * @returns Buffer
 */
function base64ToBuffer(base64String) {
    return Buffer.from(base64String, "base64");
}
/**
 * Convert buffer to base64 string
 * @param buffer Buffer to convert
 * @returns Base64 encoded string
 */
function bufferToBase64(buffer) {
    return buffer.toString("base64");
}
