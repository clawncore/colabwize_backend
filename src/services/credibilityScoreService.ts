import logger from "../monitoring/logger";

export type CredibilityLevel = "high" | "medium" | "low";

export interface CredibilityScore {
    level: CredibilityLevel;
    score: number; // 0-100
    color: "green" | "yellow" | "red";
    factors: {
        citationScore: number;
        recencyScore: number;
        peerReviewScore: number;
        journalScore: number;
    };
    flags: string[];
    recommendation: string;
}

export interface PaperMetadata {
    title: string;
    year?: number;
    citationCount?: number;
    journal?: string;
    url?: string;
    isPeerReviewed?: boolean;
    authors?: string[];
}

export class CredibilityScoreService {
    /**
     * Calculate comprehensive credibility score for a research paper
     */
    static calculateCredibility(paper: PaperMetadata): CredibilityScore {
        const factors = {
            citationScore: this.calculateCitationScore(paper),
            recencyScore: this.calculateRecencyScore(paper),
            peerReviewScore: this.calculatePeerReviewScore(paper),
            journalScore: this.calculateJournalScore(paper)
        };

        // Weighted average
        const weights = {
            citation: 0.35,
            recency: 0.25,
            peerReview: 0.25,
            journal: 0.15
        };

        const totalScore =
            factors.citationScore * weights.citation +
            factors.recencyScore * weights.recency +
            factors.peerReviewScore * weights.peerReview +
            factors.journalScore * weights.journal;

        const flags = this.detectFlags(paper, factors);
        const level = this.determineLevel(totalScore);
        const color = this.getLevelColor(level);

        return {
            level,
            score: Math.round(totalScore),
            color,
            factors,
            flags,
            recommendation: this.getRecommendation(level, flags)
        };
    }

    /**
     * Citation score based on citation count and age
     */
    private static calculateCitationScore(paper: PaperMetadata): number {
        if (!paper.citationCount) return 50; // Neutral for unknown

        const currentYear = new Date().getFullYear();
        const age = paper.year ? currentYear - paper.year : 1;

        // Citations per year
        const citationsPerYear = paper.citationCount / Math.max(age, 1);

        // Scoring thresholds
        if (citationsPerYear >= 50) return 100;
        if (citationsPerYear >= 20) return 90;
        if (citationsPerYear >= 10) return 80;
        if (citationsPerYear >= 5) return 70;
        if (citationsPerYear >= 2) return 60;
        if (citationsPerYear >= 1) return 50;
        return 30;
    }

    /**
     * Recency score - newer papers weighted higher
     */
    private static calculateRecencyScore(paper: PaperMetadata): number {
        if (!paper.year) return 50;

        const currentYear = new Date().getFullYear();
        const age = currentYear - paper.year;

        if (age <= 2) return 100; // Very recent
        if (age <= 5) return 85;  // Recent
        if (age <= 10) return 70; // Moderately recent
        if (age <= 15) return 50; // Aging
        if (age <= 20) return 30; // Old
        return 15; // Very old
    }

    /**
     * Peer review score
     */
    private static calculatePeerReviewScore(paper: PaperMetadata): number {
        if (paper.isPeerReviewed === true) return 100;
        if (paper.isPeerReviewed === false) return 20;

        // If unknown, check URL for preprint indicators
        if (paper.url) {
            const url = paper.url.toLowerCase();
            if (url.includes('arxiv') || url.includes('ssrn') || url.includes('biorxiv')) {
                return 40; // Likely preprint
            }
        }

        return 60; // Unknown, assume moderate
    }

    /**
     * Journal reputation score
     */
    private static calculateJournalScore(paper: PaperMetadata): number {
        if (!paper.journal) return 50;

        const journal = paper.journal.toLowerCase();

        // Predatory journal indicators
        const predatoryIndicators = [
            'international journal of advanced',
            'global journal of',
            'world journal of',
            'universal journal of'
        ];

        if (predatoryIndicators.some(indicator => journal.includes(indicator))) {
            return 10; // Likely predatory
        }

        // High-reputation journals (basic check)
        const highReputation = [
            'nature',
            'science',
            'cell',
            'lancet',
            'jama',
            'nejm',
            'proceedings of the national academy'
        ];

        if (highReputation.some(rep => journal.includes(rep))) {
            return 100;
        }

        // Default to moderate for unknown journals
        return 60;
    }

    /**
     * Detect credibility flags/warnings
     */
    private static detectFlags(paper: PaperMetadata, factors: any): string[] {
        const flags: string[] = [];

        // Old paper
        if (factors.recencyScore < 40) {
            flags.push("Paper is more than 15 years old");
        }

        // Low citations
        if (factors.citationScore < 40) {
            flags.push("Low citation count for age");
        }

        // Not peer-reviewed
        if (factors.peerReviewScore < 50) {
            flags.push("May not be peer-reviewed or is a preprint");
        }

        // Suspicious journal
        if (factors.journalScore < 30) {
            flags.push("⚠️ Possible predatory journal");
        }

        // No metadata
        if (!paper.citationCount && !paper.year) {
            flags.push("Limited metadata available");
        }

        return flags;
    }

    /**
     * Determine credibility level
     */
    private static determineLevel(score: number): CredibilityLevel {
        if (score >= 80) return "high";
        if (score >= 50) return "medium";
        return "low";
    }

    /**
     * Get color for level
     */
    private static getLevelColor(level: CredibilityLevel): "green" | "yellow" | "red" {
        switch (level) {
            case "high": return "green";
            case "medium": return "yellow";
            case "low": return "red";
        }
    }

    /**
     * Get user-facing recommendation
     */
    private static getRecommendation(level: CredibilityLevel, flags: string[]): string {
        if (level === "high") {
            return "High credibility - suitable for citation";
        }
        if (level === "medium") {
            return "Moderate credibility - review carefully";
        }
        if (flags.some(f => f.includes("predatory"))) {
            return "⚠️ Low credibility - verify source quality before use";
        }
        return "Low credibility - use with caution";
    }

    /**
     * Batch calculate credibility for multiple papers
     */
    static batchCalculateCredibility(papers: PaperMetadata[]): Map<string, CredibilityScore> {
        const results = new Map<string, CredibilityScore>();

        papers.forEach((paper, index) => {
            const score = this.calculateCredibility(paper);
            results.set(paper.title, score);
        });

        logger.info("Batch credibility scoring complete", {
            totalPapers: papers.length,
            highCredibility: Array.from(results.values()).filter(s => s.level === "high").length,
            mediumCredibility: Array.from(results.values()).filter(s => s.level === "medium").length,
            lowCredibility: Array.from(results.values()).filter(s => s.level === "low").length
        });

        return results;
    }
}
