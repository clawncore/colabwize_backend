import axios from "axios";
import { SecretsService } from "./secrets-service";
import logger from "../monitoring/logger";

export class CopyleaksService {
    private static AUTH_URL = "https://id.copyleaks.com/v3/account/login/api";
    private static API_URL = "https://api.copyleaks.com/v3";

    private static token: string | null = null;
    private static tokenExpiry: Date | null = null;

    /**
     * authenticate with Copyleaks V3
     */
    private static async authenticate() {
        // Check if token is valid
        if (this.token && this.tokenExpiry && this.tokenExpiry > new Date()) {
            return this.token;
        }

        const email = await SecretsService.getSecret("COPYLEAKS_EMAIL");
        const key = await SecretsService.getSecret("COPYLEAKS_API_KEY");

        if (!email || !key) {
            throw new Error("Copyleaks credentials not configured");
        }

        try {
            const response = await axios.post(this.AUTH_URL, {
                email,
                key,
            });

            this.token = response.data.access_token;
            // Expires in seconds, usually 48 hours
            const expiresIn = response.data.expires_in || 172800;
            this.tokenExpiry = new Date(Date.now() + (expiresIn - 300) * 1000); // Buffer 5m

            return this.token;
        } catch (error: any) {
            logger.error("Copyleaks authentication failed", { error: error.message });
            throw new Error("Failed to authenticate with Copyleaks");
        }
    }

    /**
     * Submit text for scanning
     */
    static async submitScan(
        scanId: string,
        content: string,
        webhookResultUrl: string
    ): Promise<void> {
        try {
            const token = await this.authenticate();

            // Submit to file endpoint (text mode)
            await axios.put(
                `${this.API_URL}/scans/submit/file/${scanId}`,
                {
                    base64: Buffer.from(content).toString("base64"),
                    filename: "document.txt",
                    properties: {
                        webhooks: {
                            status: `${webhookResultUrl}/{STATUS}` // e.g. /copyleaks/completed
                        },
                        sandbox: process.env.NODE_ENV === "development" // Use sandbox in dev
                    }
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            logger.info("Submitted Copyleaks scan", { scanId });
        } catch (error: any) {
            logger.error("Failed to submit Copyleaks scan", { error: error.message });
            throw error;
        }
    }

    /**
     * Export full report (after completion)
     */
    static async getReport(scanId: string): Promise<any> {
        try {
            const token = await this.authenticate();

            // Get the specific report (crawled version vs text)
            // Usually we export the completion report or crawled results
            // For simplicity, let's assume we want the full report export structure
            const response = await axios.get(
                `${this.API_URL}/downloads/${scanId}/export/completion`, // Simplified endpoint concept
                {
                    headers: { Authorization: `Bearer ${token}` }
                }
            );
            return response.data;
        } catch (error: any) {
            logger.warn("Failed to get Copyleaks report", { error: error.message });
            return null;
        }
    }
}
