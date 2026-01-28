import logger from "../monitoring/logger";

export interface AIDetectionResult {
    overallScore: number; // 0-100 probability of being AI
    classification: "human" | "mixed" | "ai";
    sentences: AISentenceResult[];
    scannedAt: Date;
}

export interface AISentenceResult {
    text: string;
    score: number; // 0-100
    classification: "human" | "likely_human" | "likely_ai" | "ai";
    positionStart: number;
    positionEnd: number;
}

export class AIDetectionService {
    /**
     * Detect AI-generated content in a document using GPTZero API
     */
    static async detectAI(content: string): Promise<AIDetectionResult> {
        const GPTZERO_API_KEY = process.env.GPTZERO_API_KEY;

        if (!GPTZERO_API_KEY) {
            logger.error("GPTZero API key not configured");
            throw new Error("AI detection service is not configured. Please contact support.");
        }

        try {
            logger.info("Starting AI detection scan with GPTZero", {
                contentLength: content.length
            });

            return await this.detectWithGPTZero(content, GPTZERO_API_KEY);
        } catch (error: any) {
            logger.error("Error in AI detection service", {
                error: error.message,
                stack: error.stack
            });
            throw new Error(`AI detection failed: ${error.message}`);
        }
    }

    /**
     * Professional Detection via GPTZero API
     */
    private static async detectWithGPTZero(content: string, apiKey: string): Promise<AIDetectionResult> {
        const axios = (await import("axios")).default;

        try {
            const response = await axios.post(
                "https://api.gptzero.me/v2/predict/text",
                { document: content },
                {
                    headers: {
                        "x-api-key": apiKey,
                        "Content-Type": "application/json",
                    },
                    timeout: 30000, // 30 second timeout
                }
            );

            const data = response.data;

            // Validate response structure
            if (!data.documents || !data.documents[0]) {
                throw new Error("Invalid response from GPTZero API");
            }

            const doc = data.documents[0];
            const overallScore = (doc.completely_generated_prob || 0) * 100;

            // Map sentences with position tracking
            let currentPosition = 0;
            const sentences: AISentenceResult[] = (doc.sentences || []).map((s: any) => {
                const score = (s.generated_prob || 0) * 100;
                const sentenceText = s.sentence || "";

                // Find sentence position in content
                const positionStart = content.indexOf(sentenceText, currentPosition);
                const positionEnd = positionStart >= 0
                    ? positionStart + sentenceText.length
                    : currentPosition + sentenceText.length;

                currentPosition = positionEnd;

                return {
                    text: sentenceText,
                    score: score,
                    classification: this.classifySentence(score),
                    positionStart: Math.max(0, positionStart),
                    positionEnd: positionEnd,
                };
            });

            logger.info("GPTZero scan completed", {
                overallScore,
                sentenceCount: sentences.length
            });

            return {
                overallScore,
                classification: this.classifyOverall(overallScore),
                sentences,
                scannedAt: new Date(),
            };
        } catch (error: any) {
            if (error.response) {
                logger.error("GPTZero API error", {
                    status: error.response.status,
                    data: error.response.data
                });

                if (error.response.status === 401) {
                    throw new Error("Invalid GPTZero API key");
                } else if (error.response.status === 429) {
                    throw new Error("GPTZero API rate limit exceeded. Please try again later.");
                } else {
                    throw new Error(`GPTZero API error: ${error.response.data?.message || error.message}`);
                }
            }
            throw error;
        }
    }

    private static classifySentence(score: number): "human" | "likely_human" | "likely_ai" | "ai" {
        if (score < 20) return "human";
        if (score < 50) return "likely_human";
        if (score < 80) return "likely_ai";
        return "ai";
    }

    private static classifyOverall(score: number): "human" | "mixed" | "ai" {
        if (score < 30) return "human";
        if (score < 70) return "mixed";
        return "ai";
    }
}
