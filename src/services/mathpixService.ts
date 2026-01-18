import axios from "axios";
import fs from "fs/promises";
import FormData from "form-data";
import { config } from "../config/env";
import logger from "../monitoring/logger";

interface MathpixOptions {
    rm_spaces?: boolean;
}

export class MathpixService {
    private static readonly API_URL = "https://api.mathpix.com/v3/pdf";

    private static getHeaders() {
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
    static async convertPdfToHtml(filePath: string, options: MathpixOptions = {}): Promise<string> {
        try {
            logger.info("[Mathpix] Starting PDF conversion", { filePath });

            // 1. Upload File
            const pdfId = await this.uploadPdf(filePath);
            logger.info("[Mathpix] File uploaded", { pdfId });

            // 2. Poll for Completion
            await this.waitForCompletion(pdfId);
            logger.info("[Mathpix] Conversion completed", { pdfId });

            // 3. Retrieve Result (HTML)
            const html = await this.getConversionResult(pdfId, "html");
            logger.info("[Mathpix] Result retrieved", { pdfId, length: html.length });

            return html;
        } catch (error: any) {
            logger.error("[Mathpix] Conversion failed", {
                error: error.message,
                response: error.response?.data
            });
            throw new Error(`Mathpix conversion failed: ${error.message}`);
        }
    }

    /**
     * Uploads the PDF file to Mathpix
     */
    private static async uploadPdf(filePath: string): Promise<string> {
        const formData = new FormData();
        const fileBuffer = await fs.readFile(filePath);
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

        const response = await axios.post(this.API_URL, formData, {
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
    private static async waitForCompletion(pdfId: string): Promise<void> {
        const maxAttempts = 60; // 2 minutes (assuming 2s interval)
        let attempts = 0;

        while (attempts < maxAttempts) {
            const response = await axios.get(`${this.API_URL}/${pdfId}`, {
                headers: this.getHeaders(),
            });

            const status = response.data.status;

            if (status === "completed") {
                return;
            } else if (status === "error") {
                throw new Error("Mathpix reported conversion error");
            } else if (status === "split" || status === "loaded") {
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
    private static async getConversionResult(pdfId: string, format: "html" | "mmd"): Promise<string> {
        const response = await axios.get(`${this.API_URL}/${pdfId}.${format}`, {
            headers: this.getHeaders(),
            responseType: "text", // Ensure we get text back
        });

        return response.data;
    }
}
