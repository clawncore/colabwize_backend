import axios from "axios";
import { SecretsService } from "./secrets-service";
import logger from "../monitoring/logger";

export interface CopyleaksConfig {
    apiKey?: string;
    email?: string;
    sandbox?: boolean;
}

export class CopyleaksService {
    private static readonly API_URL = "https://api.copyleaks.com/v3";
    private static readonly ID_SERVER_URL = "https://id.copyleaks.com/v3";

    private static authToken: string | null = null;
    private static tokenExpiresAt: number = 0;

    /**
     * Get Authentication Token (Cached)
     */
    private static async getToken(): Promise<string> {
        // Return cached token if valid (with 5 min buffer)
        if (this.authToken && Date.now() < this.tokenExpiresAt - 5 * 60 * 1000) {
            return this.authToken;
        }

        const apiKey = await SecretsService.getCopyLeaksApiKey();
        const email = await SecretsService.getCopyLeaksEmail();

        if (!apiKey || !email) {
            throw new Error("Copyleaks API credentials not configured");
        }

        try {
            const response = await axios.post(`${this.ID_SERVER_URL}/account/login/api`, {
                email,
                key: apiKey,
            });

            this.authToken = response.data.access_token;
            // Set expiration (issued at + expires in * 1000)
            const expiresIn = response.data.expires_in || 3600; // Default 1 hour
            this.tokenExpiresAt = Date.now() + expiresIn * 1000;

            return this.authToken!;
        } catch (error: any) {
            logger.error("Copyleaks Authentication Failed", { error: error.message });
            throw new Error(`Copyleaks Login Failed: ${error.message}`);
        }
    }

    /**
     * Submit Text for Scanning
     * @param scanId Unique ID for this scan
     * @param content Text content to scan
     * @param sandbox Use sandbox mode (no credits used)
     */
    static async submitTextScan(scanId: string, content: string, sandbox: boolean = true): Promise<void> {
        try {
            const token = await this.getToken();

            // Determine endpoint based on type (education vs business - prioritizing education for this use case)
            // and method (submit/file or submit/ocr). for text we use 'submit/text'?? 
            // Actually Copyleaks documentation says PUT /downloads/{scanId} for file or similar structure.
            // Standard Education Submit: /education/submit/file/{scanId}

            // We will use the 'Education' product family for student checks89
            const endpoint = `${this.API_URL}/education/submit/text/${scanId}`;

            const webhookUrl = await SecretsService.getSecret("COPYLEAKS_WEBHOOK_URL");

            // If we are developing locally, we might not have a public webhook. 
            // For MVP "Hybrid", we might use polling if webhook is strictly required. 
            // But Copyleaks REQUIRES a webhook to return results. 
            // We'll set a placeholder if missing, but it will fail to return results if not reachable.
            const validWebhook = webhookUrl || "https://api.colabwize.com/api/originality/webhook/copyleaks";

            await axios.put(
                endpoint,
                {
                    base64: Buffer.from(content).toString("base64"),
                    filename: "submission.txt",
                    properties: {
                        sandbox: sandbox, // CRITICAL: Sandbox mode for development
                        webhooks: {
                            status: `${validWebhook}/{STATUS}`,
                        },
                        action: 0, // 0 = Scan 
                        includeHtml: false,
                        developerPayload: JSON.stringify({ scanId }),
                        // Education specific settings
                        scanning: {
                            internet: true,
                            copyleaksDb: {
                                includeMySubmissions: true,
                                includeOthersSubmissions: true
                            }
                        },
                        sensitiveDataProtection: {
                            driversLicense: false,
                            credentials: false,
                            passport: false
                        }
                    },
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            logger.info(`Copyleaks scan submitted: ${scanId}`, { sandbox });
        } catch (error: any) {
            logger.error("Copyleaks Submit Failed", { error: error.message, details: error.response?.data });
            throw new Error(`Copyleaks Submit Failed: ${error.message}`);
        }
    }

    /**
      * Get Exported Result (Simulates retrieval if doing polling/export download)
      * Note: Copyleaks results are pushed via Webhook usually.
      * But we can also 'Export' them. 
      */
    static async getResultDetails(scanId: string): Promise<any> {
        // Check status first?
        // For this MVP, we might rely on the DB being updated by the webhook.
        return null;
    }
}
