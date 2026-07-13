"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DraftComparisonService = void 0;
const string_similarity_1 = require("string-similarity");
const logger_1 = __importDefault(require("../monitoring/logger"));
class DraftComparisonService {
    static SELF_PLAGIARISM_THRESHOLD = 0.85; // 85% similarity
    static REUSE_THRESHOLD = 0.4; // 40% similarity
    /**
     * Compare two drafts and return detailed analysis
     */
    static async compareDrafts(currentDraft, previousDraft) {
        try {
            if (!currentDraft || !previousDraft) {
                throw new Error("Both drafts are required for comparison");
            }
            // Normalize texts
            const normCurrent = this.normalizeText(currentDraft);
            const normPrevious = this.normalizeText(previousDraft);
            // 1. Overall Similarity Score
            const similarityScore = (0, string_similarity_1.compareTwoStrings)(normCurrent, normPrevious);
            // 2. Fragment Analysis (Basic Diff-like approach)
            // Extract sentences and check for matches
            const matchedSegments = this.findMatchingSegments(currentDraft, previousDraft);
            // 3. Calculate Overlap Percentage (based on matched chars / total chars)
            const matchedChars = matchedSegments.reduce((acc, match) => acc + match.segment.length, 0);
            const overlapPercentage = matchedChars / currentDraft.length;
            // 4. Generate Analysis
            const analysis = this.generateAnalysis(similarityScore, overlapPercentage);
            return {
                similarityScore: similarityScore * 100,
                overlapPercentage: overlapPercentage * 100,
                matchedSegments,
                analysis,
                isSelfPlagiarismInternal: similarityScore > this.SELF_PLAGIARISM_THRESHOLD,
            };
        }
        catch (error) {
            logger_1.default.error("Error comparing drafts", { error: error.message });
            throw error;
        }
    }
    /**
     * Normalize text for comparison
     */
    static normalizeText(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/gi, "")
            .replace(/\s+/g, " ")
            .trim();
    }
    /**
     * Find matching segments between two texts
     * Uses a sentence-based approach for granularity
     */
    static findMatchingSegments(current, previous) {
        const sentences = current.match(/[^.!?]+[.!?]+/g) || [current];
        const prevSentences = previous.match(/[^.!?]+[.!?]+/g) || [previous];
        const matches = [];
        // Simple cache for previous sentences normalized
        const prevNorm = prevSentences.map((s) => ({
            text: s,
            norm: this.normalizeText(s),
        }));
        let currentPos = 0;
        for (const sentence of sentences) {
            const normSentence = this.normalizeText(sentence);
            if (normSentence.length < 20) {
                // Skip short fragments
                currentPos += sentence.length;
                continue;
            }
            // Find best match in previous draft
            let bestMatch = { score: 0, index: -1 };
            prevNorm.forEach((prev, idx) => {
                const score = (0, string_similarity_1.compareTwoStrings)(normSentence, prev.norm);
                if (score > bestMatch.score) {
                    bestMatch = { score, index: idx };
                }
            });
            if (bestMatch.score > 0.8) {
                // High confidence match
                matches.push({
                    segment: sentence.trim(),
                    similarity: bestMatch.score,
                    sourceParams: {
                        start: currentPos,
                        end: currentPos + sentence.length,
                    },
                    targetParams: { start: -1, end: -1 }, // We don't track exact prev pos in this simple version
                });
            }
            currentPos += sentence.length;
        }
        return matches;
    }
    /**
     * Generate human-readable analysis
     */
    static generateAnalysis(similarity, overlap) {
        if (similarity > this.SELF_PLAGIARISM_THRESHOLD) {
            return "High risk of self-plagiarism. The documents are nearly identical.";
        }
        else if (similarity > 0.6) {
            return "Significant overlap detected. Ensure you are not reusing major sections without approval.";
        }
        else if (overlap > this.REUSE_THRESHOLD) {
            return "Moderate reuse detected. Some sections appear to be copied or slightly reworded.";
        }
        else {
            return "Low overlap. The new draft appears significantly different from the previous version.";
        }
    }
}
exports.DraftComparisonService = DraftComparisonService;
