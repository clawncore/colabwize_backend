"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopyleaksService = void 0;
const axios_1 = __importDefault(require("axios"));
const secrets_service_1 = require("./secrets-service");
const logger_1 = __importDefault(require("../monitoring/logger"));
class CopyleaksService {
    static AUTH_URL = "https://id.copyleaks.com/v3/account/login/api";
    static API_URL = "https://api.copyleaks.com/v3";
    static token = null;
    static tokenExpiry = null;
    /**
     * authenticate with Copyleaks V3
     */
    static async authenticate() {
        // Check if token is valid
        if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) {
            return this.token;
        }
        const email = await secrets_service_1.SecretsService.getSecret("COPYLEAKS_EMAIL");
        const key = await secrets_service_1.SecretsService.getSecret("COPYLEAKS_API_KEY");
        if (!email || !key) {
            throw new Error("Copyleaks credentials not configured");
        }
        try {
            const response = await axios_1.default.post(this.AUTH_URL, {
                email,
                key,
            });
            this.token = response.data.access_token;
            // Expires in seconds, usually 48 hours
            const expiresIn = response.data.expires_in || 172800;
            this.tokenExpiry = new Date(Date.now() + (expiresIn - 300) * 1000); // Buffer 5m
            return this.token;
        }
        catch (error) {
            logger_1.default.error("Copyleaks authentication failed", { error: error.message });
            throw new Error("Failed to authenticate with Copyleaks");
        }
    }
    /**
     * Submit text for scanning
     */
    static async submitScan(scanId, content, webhookResultUrl) {
        try {
            const token = await this.authenticate();
            // Submit to file endpoint (text mode)
            await axios_1.default.put(`${this.API_URL}/scans/submit/file/${scanId}`, {
                base64: Buffer.from(content).toString("base64"),
                filename: "document.txt",
                properties: {
                    webhooks: {
                        status: `${webhookResultUrl}/{STATUS}` // e.g. /copyleaks/completed
                    },
                    sandbox: process.env.NODE_ENV === "development" // Use sandbox in dev
                }
            }, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            });
            logger_1.default.info("Submitted Copyleaks scan", { scanId });
        }
        catch (error) {
            logger_1.default.error("Failed to submit Copyleaks scan", { error: error.message });
            throw error;
        }
    }
    /**
     * Export full report (after completion)
     */
    static async getReport(scanId) {
        try {
            const token = await this.authenticate();
            // Get the specific report (crawled version vs text)
            // Usually we export the completion report or crawled results
            // For simplicity, let's assume we want the full report export structure
            const response = await axios_1.default.get(`${this.API_URL}/downloads/${scanId}/export/completion`, // Simplified endpoint concept
            {
                headers: { Authorization: `Bearer ${token}` }
            });
            return response.data;
        }
        catch (error) {
            logger_1.default.warn("Failed to get Copyleaks report", { error: error.message });
            return null;
        }
    }
}
exports.CopyleaksService = CopyleaksService;
