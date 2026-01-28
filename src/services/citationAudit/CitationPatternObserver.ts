import { CitationStyle, PatternType } from "../../types/citationAudit";
import { getStyleRules } from "./styleRules";

export interface CitationFlag {
    type: "STYLE_VIOLATION";
    location: { start: number; end: number };
    detectedPattern: PatternType;
    expectedPattern: PatternType[]; // Allowed patterns
    confidence: number;
    message: string;
}

/**
 * Citation Pattern Observer
 * 
 * Deterministic, non-AI logic layer to observe citation patterns and flag inconsistencies.
 * Defined by behavioral contract: PROMPT 2.
 */
export class CitationPatternObserver {

    // Regex Definitions for Pattern Types
    private static readonly PATTERNS: Record<PatternType, RegExp> = {
        // [1], [1, 2], [1]-[3]
        "NUMERIC_BRACKET": /\[\s*\d+(?:[\s,–-]+\d+)*\s*\]/g,

        // (Smith, 2020) or (Smith et al., 2020)
        "AUTHOR_YEAR": /\([A-Z][a-z]+(?: et al\.?)?,?\s*\d{4}[a-z]?\)/g,

        // (Smith 24) or (Smith, p. 24)
        "AUTHOR_PAGE": /\([A-Z][a-z]+(?: et al\.?)?(?:,|\s)\s*(?:p\.|pp\.)?\s*\d+\)/g,

        // Specific sub-patterns for stylistic checks
        "et_al_no_period": /\b(?<!\.)et al(?!\.)\b/g, // et al without period
        "et_al_with_period": /\bet al\./g,
        "AND_IN_PAREN": /\([^\)]*\band\b[^\)]*\)/g, // 'and' inside Parens (usually bad for APA)
        "AMPERSAND_IN_PAREN": /\([^\)]*&[^\)]*\)/g,  // '&' inside Parens
        "MIXED_STYLE": /$^/, // Placeholder; detection is logic-based, not regex-based
    };

    /**
     * Observe the document content and emit flags for style violations.
     * Runs cheaply and deterministically.
     */
    static observe(text: string, activeStyle: CitationStyle): CitationFlag[] {
        const flags: CitationFlag[] = [];
        const rules = getStyleRules(activeStyle);
        const disallowed = rules.disallowedInlinePatterns;

        // Check for Disallowed Patterns
        for (const patternType of disallowed) {
            // Skip if we don't have a regex for this specific pattern type in our observer (some might be theoretical)
            const regex = this.PATTERNS[patternType];
            if (!regex) continue;

            // Reset lastIndex for global regex
            regex.lastIndex = 0;

            let match;
            while ((match = regex.exec(text)) !== null) {
                flags.push({
                    type: "STYLE_VIOLATION",
                    location: {
                        start: match.index,
                        end: match.index + match[0].length
                    },
                    detectedPattern: patternType,
                    expectedPattern: rules.allowedInlinePatterns,
                    confidence: 1.0, // Regex is deterministic
                    message: rules.messages[patternType] || "Invalid citation format for this style."
                });
            }
        }

        // Additional specific checks if matched (e.g. "and" vs "&")
        // If APA, check specific bad patterns even if AUTHOR_YEAR is allowed
        // Actually, `disallowedInlinePatterns` in `styleRules.ts` should cover "AND_IN_PAREN" etc.
        // So the loop above handles it.

        return flags;
    }

    /**
     * PROMPT 5: Live Consistency Watcher (Drift Detection)
     * Check for mixed citation styles (e.g. Numeric vs Author-Year).
     */
    static detectMixedStyles(text: string): CitationFlag[] {
        const flags: CitationFlag[] = [];

        let numericCount = 0;
        let authorYearCount = 0;

        // Check Numeric
        const numRegex = new RegExp(this.PATTERNS["NUMERIC_BRACKET"]); // Copy regex
        numRegex.lastIndex = 0;
        while (numRegex.exec(text) !== null) numericCount++;

        // Check Author-Year
        const ayRegex = new RegExp(this.PATTERNS["AUTHOR_YEAR"]);
        ayRegex.lastIndex = 0;
        while (ayRegex.exec(text) !== null) authorYearCount++;

        // Threshold for determining mixing (at least 1 of each is technically mixed, 
        // but let's say we Flag it if we see both)
        if (numericCount > 0 && authorYearCount > 0) {
            flags.push({
                type: "STYLE_VIOLATION",
                location: { start: 0, end: 0 }, // Global flag
                detectedPattern: "MIXED_STYLE",
                expectedPattern: [],
                confidence: 1.0,
                message: `Make citation style detected: ${numericCount} Numeric vs ${authorYearCount} Author-Year. Stick to one style.`
            });
        }

        return flags;
    }
}
