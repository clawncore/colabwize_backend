"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MathpixService = void 0;
const axios_1 = __importDefault(require("axios"));
const promises_1 = __importDefault(require("fs/promises"));
const form_data_1 = __importDefault(require("form-data"));
const logger_1 = __importDefault(require("../monitoring/logger"));
class MathpixService {
    static API_URL = "https://api.mathpix.com/v3/pdf";
    static getHeaders() {
        const appId = process.env.MATHPIX_APP_ID;
        const appKey = process.env.MATHPIX_APP_KEY;
        if (!appId || !appKey) {
            throw new Error("Mathpix API credentials not found");
        }
        return {
            "app_id": appId,
            "app_key": appKey,
        };
    }
    /**
     * Uploads a PDF to Mathpix and returns the conversion result as HTML.
     * This handles the async polling mechanism.
     */
    static async convertPdfToHtml(filePath, options = {}) {
        try {
            logger_1.default.info("[Mathpix] Starting PDF conversion", { filePath });
            // 1. Upload File
            const pdfId = await this.uploadPdf(filePath);
            logger_1.default.info("[Mathpix] File uploaded", { pdfId });
            // 2. Poll for Completion
            await this.waitForCompletion(pdfId);
            logger_1.default.info("[Mathpix] Conversion completed", { pdfId });
            // 3. Retrieve Result (HTML)
            const html = await this.getConversionResult(pdfId, "html");
            logger_1.default.info("[Mathpix] Result retrieved", { pdfId, length: html.length });
            return html;
        }
        catch (error) {
            logger_1.default.error("[Mathpix] Conversion failed", {
                error: error.message,
                response: error.response?.data
            });
            throw new Error(`Mathpix conversion failed: ${error.message}`);
        }
    }
    /**
     * Uploads the PDF file to Mathpix
     */
    static async uploadPdf(filePath) {
        const formData = new form_data_1.default();
        const fileBuffer = await promises_1.default.readFile(filePath);
        formData.append("file", fileBuffer, {
            filename: "document.pdf",
            contentType: "application/pdf"
        });
        const options = {
            conversion_formats: {
                html: true,
                mmd: true
            },
            math_inline_delimiters: ["$", "$"],
            rm_spaces: true
        };
        formData.append("options_json", JSON.stringify(options));
        const response = await axios_1.default.post(this.API_URL, formData, {
            headers: {
                ...this.getHeaders(),
                ...formData.getHeaders(),
            },
        });
        if (response.data && response.data.pdf_id) {
            return response.data.pdf_id;
        }
        throw new Error("Failed to upload PDF: No pdf_id returned");
    }
    /**
     * Polls the status endpoint until conversion is completed
     */
    static async waitForCompletion(pdfId) {
        const maxAttempts = 60; // 2 minutes (assuming 2s interval)
        let attempts = 0;
        while (attempts < maxAttempts) {
            const response = await axios_1.default.get(`${this.API_URL}/${pdfId}`, {
                headers: this.getHeaders(),
            });
            const status = response.data.status;
            if (status === "completed") {
                return;
            }
            else if (status === "error") {
                throw new Error("Mathpix reported conversion error");
            }
            else if (status === "split" || status === "loaded") {
                // Still processing
            }
            attempts++;
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        throw new Error("Mathpix conversion timed out");
    }
    /**
     * Downloads the converted result
     */
    static async getConversionResult(pdfId, format) {
        const response = await axios_1.default.get(`${this.API_URL}/${pdfId}.${format}`, {
            headers: this.getHeaders(),
            responseType: "text", // Ensure we get text back
        });
        return response.data;
    }
}
exports.MathpixService = MathpixService;
