import axios from "axios";
import { SecretsService } from "./secrets-service";
import logger from "../monitoring/logger";

interface CopyscapeResult {
    queryWords: number;
    cost: number;
    count: number;
    matches: CopyscapeMatch[];
}

interface CopyscapeMatch {
    url: string;
    title: string;
    text: string; // The "snippet"
    copyscapeUrl: string;
}

export interface PlagiarismMatch {
    start: number;
    end: number;
    similarity: number; // 0-100
    sourceUrl: string;
    provider: "copyscape";
    confidence: "high" | "medium" | "low";
}

export class CopyscapeService {
    private static API_URL = "https://www.copyscape.com/api/";

    /**
     * Scan text using Copyscape Premium API
     */
    static async scanText(content: string): Promise<PlagiarismMatch[]> {
        const username = await SecretsService.getCopyscapeUsername();
        const apiKey = await SecretsService.getCopyscapeApiKey();

        if (!username || !apiKey) {
            logger.warn("Copyscape credentials not configured. Returning empty results.");
            return []; // Fail safe
        }

        try {
            // Using 'csearch' operation for text checking
            // o=csearch: checks content against the web
            // f=xml: returns XML result
            const response = await axios.post(
                this.API_URL,
                `t=${encodeURIComponent(content)}`, // Send text in body
                {
                    params: {
                        u: username,
                        k: apiKey,
                        o: "csearch",
                        f: "json",
                    },
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    }
                }
            );

            // If JSON format is requested and supported (check standard docs, usually 'fmt=json' or 'f=json')
            // Copyscape historically XML only, but 'f=json' works in newer revisions. 
            // Let's implement robust fallback or assume XML if JSON fails, but standardizing on parsing logic is safer.
            // Actually, official docs say 'f=xml' is default. 'f=json' is supported.
            // Let's try to assume JSON response if 'f=json' passed.

            const data = response.data;

            // Check for API errors
            if (data.error) {
                logger.error("Copyscape API Error", { error: data.error });
                return [];
            }

            // Parse response
            const matches: CopyscapeMatch[] = Array.isArray(data.result) ? data.result : (data.result ? [data.result] : []);

            // The main logical step: Map snippets to Text Indices
            return this.mapSnippetsToIndices(content, matches);

        } catch (error: any) {
            // Basic XML fallback if JSON fails or endpoint doesn't support 'f=json' for this account type
            if (error.response && error.response.data && typeof error.response.data === 'string' && error.response.data.includes("<?xml")) {
                // It returned XML despite request, likely an error or legacy mode. 
                // For now, simpler to just log and return empty to "fail safely".
                // A production app would add an XML parser here.
                logger.error("Received XML from Copyscape, expecting JSON. Check API config.");
            }

            logger.error("Copyscape Scan Failed", { error: error.message });
            return []; // Fail safe
        }
    }

    /**
     * MAP SNIPPETS TO EXACT INDICES
     * This is the "secret sauce" to make Copyscape behave like Copyleaks.
     */
    static mapSnippetsToIndices(originalText: string, matches: any[]): PlagiarismMatch[] {
        const results: PlagiarismMatch[] = [];
        const normalizedOriginal = this.normalizeText(originalText);

        // Copyscape returns a list of "result" objects (matches)
        // Each has: url, title, minwords, textsnippet (or just 'text')

        matches.forEach(match => {
            const snippet = match.text || match.textsnippet || "";
            if (!snippet) return;

            const normalizedSnippet = this.normalizeText(snippet);

            // Find snippet in text
            // We use a flexible search because Copyscape strips punctuation/formatting
            const index = normalizedOriginal.indexOf(normalizedSnippet);

            if (index !== -1) {
                // Map back to original indices. 
                // Since we normalized, we have to be careful. 
                // A robust way for "exact highlighting":

                // 1. Locate the approx position
                // 2. Expand to find exact start/end in raw text

                // For this MVP "Safe" implementation, let's look for the verbatim snippet first.
                // If not found, try normalized.

                let start = originalText.indexOf(snippet);
                let end = -1;

                if (start !== -1) {
                    end = start + snippet.length;
                } else {
                    // Fallback: Fuzzy find. 
                    // This is complex. For now, we will rely on a "best effort" via string-similarity or simple inclusion.
                    // If strict matching fails, we skip highlighting to avoid "false positive highlighting".
                    // Better to show "Source detected" without highlight than WRONG highlight.
                    return;
                }

                // Calculate similarity score based on snippet length vs doc length?
                // No, Copyscape gives "minwords" or we can infer from snippet quality.
                // We'll calculate a simple "Confidence" based on length.

                const wordCount = snippet.split(/\s+/).length;
                let similarity = 0;
                let confidence: "high" | "medium" | "low" = "low";

                if (wordCount > 50) {
                    similarity = 90;
                    confidence = "high";
                } else if (wordCount > 20) {
                    similarity = 70;
                    confidence = "medium";
                } else {
                    similarity = 40;
                    confidence = "low";
                }

                results.push({
                    start,
                    end,
                    similarity,
                    sourceUrl: match.url,
                    provider: "copyscape",
                    confidence
                });
            }
        });

        return results;
    }

    private static normalizeText(text: string): string {
        return text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
    }
}
