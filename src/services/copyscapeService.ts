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
    viewurl?: string;
    minwordsmatched?: number;
    urlwords?: number;
    wordsmatched?: number;
    percentmatched?: number;
}

export interface PlagiarismMatch {
    start: number;
    end: number;
    similarity: number; // 0-100
    sourceUrl: string;
    viewUrl?: string; // New: Link to comparison
    matchedWords?: number; // New: Matched count
    sourceWords?: number; // New: Total words on source page
    matchPercent?: number; // New: % of source matched
    provider: "copyscape";
    confidence: "high" | "medium" | "low";
}

export class CopyscapeService {
    private static API_URL = "https://www.copyscape.com/api/";

    /**
     * Scan text using Copyscape Premium API
     */
    static async scanText(content: string): Promise<{ matches: PlagiarismMatch[], summary: any }> {
        // ============================================
        // TEMPORARY: Mock mode for testing WITHOUT credits
        // Remove this block after UI testing is complete
        // ============================================
        const USE_MOCK_DATA = false; // Set to false to use real Copyscape

        if (USE_MOCK_DATA) {
            logger.info("MOCK MODE: Returning test data (no Copyscape API call)");

            // Simulate API delay
            await new Promise(resolve => setTimeout(resolve, 1500));

            // Calculate positions based on actual content length
            const contentLength = content.length;
            const words = content.split(/\s+/);
            const wordCount = words.length;

            // Create 3 matches at different positions in the document
            const mockMatches: PlagiarismMatch[] = [];

            // Match 1: First ~15-20% of document (high similarity)
            const match1Start = Math.floor(contentLength * 0.05);
            const match1End = Math.min(match1Start + 150, Math.floor(contentLength * 0.20));
            if (match1End > match1Start) {
                mockMatches.push({
                    start: match1Start,
                    end: match1End,
                    similarity: 85,
                    sourceUrl: "https://www.archives.gov/founding-docs/declaration-transcript",
                    viewUrl: "https://www.copyscape.com/view.php?o=123456",
                    matchedWords: Math.floor((match1End - match1Start) / 5), // Approx words
                    sourceWords: 250,
                    matchPercent: 38,
                    provider: "copyscape",
                    confidence: "high"
                });
            }

            // Match 2: Middle ~30-45% of document (moderate similarity)
            const match2Start = Math.floor(contentLength * 0.30);
            const match2End = Math.min(match2Start + 120, Math.floor(contentLength * 0.45));
            if (match2End > match2Start && contentLength > 300) {
                mockMatches.push({
                    start: match2Start,
                    end: match2End,
                    similarity: 72,
                    sourceUrl: "https://en.wikipedia.org/wiki/United_States_Declaration_of_Independence",
                    viewUrl: "https://www.copyscape.com/view.php?o=789012",
                    matchedWords: Math.floor((match2End - match2Start) / 5),
                    sourceWords: 180,
                    matchPercent: 36,
                    provider: "copyscape",
                    confidence: "high"
                });
            }

            // Match 3: Later ~60-75% of document (lower similarity)
            const match3Start = Math.floor(contentLength * 0.60);
            const match3End = Math.min(match3Start + 100, Math.floor(contentLength * 0.75));
            if (match3End > match3Start && contentLength > 500) {
                mockMatches.push({
                    start: match3Start,
                    end: match3End,
                    similarity: 65,
                    sourceUrl: "https://www.britannica.com/topic/Declaration-of-Independence",
                    viewUrl: "https://www.copyscape.com/view.php?o=345678",
                    matchedWords: Math.floor((match3End - match3Start) / 5),
                    sourceWords: 145,
                    matchPercent: 36,
                    provider: "copyscape",
                    confidence: "medium"
                });
            }

            const mockSummary = {
                queryWords: wordCount,
                cost: 0.0050,
                count: mockMatches.length,
                allPercentMatched: 78  // Overall score
            };

            logger.info(`MOCK: Generated ${mockMatches.length} matches for ${wordCount} words`);

            return { matches: mockMatches, summary: mockSummary };
        }
        // ============================================
        // END MOCK MODE
        // ============================================

        const username = await SecretsService.getCopyscapeUsername();
        const apiKey = await SecretsService.getCopyscapeApiKey();

        if (!username || !apiKey) {
            logger.error("Copyscape credentials missing");
            throw new Error("MISSING_CREDENTIALS");
        }

        try {
            logger.info("Calling Copyscape API", { length: content.length });

            // Prepare parameters
            const params = new URLSearchParams();
            params.append("u", username);
            params.append("k", apiKey);
            params.append("o", "csearch");
            params.append("f", "json");
            params.append("c", "3");
            params.append("t", content);

            const response = await axios.post(
                this.API_URL,
                params.toString(),
                {
                    headers: {
                        "Content-Type": "application/x-www-form-urlencoded"
                    }
                }
            );

            // Copyscape sometimes returns a string (XML) even if JSON is requested on certain errors
            // or if the account is misconfigured.
            let data = response.data;

            if (typeof data === "string") {
                try {
                    // Try to parse if it's a JSON string
                    data = JSON.parse(data);
                } catch (e) {
                    // If it's XML or other text, handle as error
                    logger.error("Copyscape returned non-JSON response", { data: data.substring(0, 500) });
                    if (data.includes("<error>")) {
                        const errorMatch = data.match(/<error>(.*?)<\/error>/);
                        throw new Error(errorMatch ? errorMatch[1] : "Format Mismatch (XML returned)");
                    }
                    throw new Error("Copyscape service returned an unexpected format. Please check your account configuration.");
                }
            }

            // Check for API errors in JSON structure
            if (data.error) {
                logger.error("Copyscape API Error", { error: data.error, response: data });
                throw new Error(data.error);
            }

            // Parse response
            const rawMatches: CopyscapeMatch[] = Array.isArray(data.result) ? data.result : (data.result ? [data.result] : []);

            // Map snippets to Text Indices
            const matches = this.mapSnippetsToIndices(content, rawMatches);

            return {
                matches,
                summary: {
                    allWordsMatched: data.allwordsmatched || 0,
                    allPercentMatched: data.allpercentmatched || 0,
                    allTextMatched: data.alltextmatched || "",
                    count: data.count || matches.length,
                    queryWords: data.querywords || 0,
                    cost: data.cost || 0
                }
            };

        } catch (error: any) {
            logger.error("Copyscape Scan Failed", { error: error.message });
            throw error;
        }
    }

    /**
     * MAP SNIPPETS TO EXACT INDICES
     * Uses a mapping approach to find snippets in original text even with formatting differences.
     */
    static mapSnippetsToIndices(originalText: string, matches: any[]): PlagiarismMatch[] {
        const results: PlagiarismMatch[] = [];

        // 1. Create a character map for normalization
        // This allows us to find matches in normalized text and map back to original indices
        const mapping: number[] = [];
        let normalizedOriginal = "";

        for (let i = 0; i < originalText.length; i++) {
            const char = originalText[i];
            const lowerChar = char.toLowerCase();

            // Only keep alphanumeric and single spaces in normalized version
            if (/[a-z0-9]/.test(lowerChar)) {
                normalizedOriginal += lowerChar;
                mapping.push(i);
            } else if (/\s/.test(char)) {
                // Collapse multiple spaces into one
                if (normalizedOriginal.length > 0 && normalizedOriginal[normalizedOriginal.length - 1] !== " ") {
                    normalizedOriginal += " ";
                    mapping.push(i);
                }
            }
        }

        matches.forEach(match => {
            const snippet = match.text || match.textsnippet || "";
            if (!snippet) return;

            // Normalize snippet similarly
            let normalizedSnippet = "";
            for (let i = 0; i < snippet.length; i++) {
                const char = snippet[i].toLowerCase();
                if (/[a-z0-9]/.test(char)) {
                    normalizedSnippet += char;
                } else if (/\s/.test(char)) {
                    if (normalizedSnippet.length > 0 && normalizedSnippet[normalizedSnippet.length - 1] !== " ") {
                        normalizedSnippet += " ";
                    }
                }
            }
            normalizedSnippet = normalizedSnippet.trim();
            if (normalizedSnippet.length < 10) return; // Ignore very short snippets to avoid false positives

            // Find in normalized original
            let index = normalizedOriginal.indexOf(normalizedSnippet);

            // If not found, try a slightly harder search (removing all spaces)
            if (index === -1) {
                const noSpaceOriginal = normalizedOriginal.replace(/\s/g, "");
                const noSpaceSnippet = normalizedSnippet.replace(/\s/g, "");
                const noSpaceIndex = noSpaceOriginal.indexOf(noSpaceSnippet);

                if (noSpaceIndex !== -1) {
                    // This is a bit more complex to map back, but for now we find the start 
                    // by counting non-space chars
                    let nonSpaceCount = 0;
                    for (let i = 0; i < normalizedOriginal.length; i++) {
                        if (normalizedOriginal[i] !== " ") {
                            if (nonSpaceCount === noSpaceIndex) {
                                index = i;
                                break;
                            }
                            nonSpaceCount++;
                        }
                    }
                }
            }

            if (index !== -1) {
                const start = mapping[index];
                // Approximate end by looking at the last mapped character
                const end = mapping[Math.min(index + normalizedSnippet.length - 1, mapping.length - 1)] + 1;

                const wordCount = snippet.split(/\s+/).length;
                results.push({
                    start,
                    end,
                    similarity: Number(match.percentmatched || (wordCount > 50 ? 90 : (wordCount > 20 ? 70 : 40))),
                    sourceUrl: match.url,
                    viewUrl: match.viewurl || match.viewUrl || `https://www.copyscape.com/view.php?o=${match.handle || ""}`,
                    matchedWords: Number(match.wordsmatched || wordCount),
                    sourceWords: Number(match.urlwords || 0),
                    matchPercent: Number(match.percentmatched || 0),
                    provider: "copyscape",
                    confidence: wordCount > 50 ? "high" : (wordCount > 20 ? "medium" : "low")
                });
            }
        });

        return results;
    }

    private static normalizeText(text: string): string {
        return text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
    }
}
