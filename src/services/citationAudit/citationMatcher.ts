import { ExtractedPattern, ReferenceEntry, CitationStyle } from "../../types/citationAudit";

/**
 * Represents a matched pair of inline citation and its corresponding reference entry
 */
export interface CitationPair {
    inline: {
        text: string;
        start: number;
        end: number;
        patternType: string;
    };
    reference: {
        rawText: string;
        index: number;
        extractedTitle?: string;
        extractedAuthor?: string;
        extractedYear?: number;
    } | null;
}

/**
 * Citation Matcher - Links inline citations to their reference entries
 */
export class CitationMatcher {
    /**
     * Match inline citations to reference entries based on citation style
     */
    static matchCitations(
        inlineCitations: ExtractedPattern[],
        referenceEntries: ReferenceEntry[],
        style: CitationStyle
    ): CitationPair[] {
        const pairs: CitationPair[] = [];

        for (const inline of inlineCitations) {
            let matchedReference: ReferenceEntry | null = null;

            if (style === "IEEE") {
                // IEEE: Match by number [1], [2], etc.
                matchedReference = this.matchIEEE(inline, referenceEntries);
            } else if (style === "APA" || style === "MLA") {
                // APA/MLA: Match by author and year
                matchedReference = this.matchAuthorYear(inline, referenceEntries);
            }

            // Extract metadata from reference if found
            const referenceData = matchedReference
                ? {
                    rawText: matchedReference.rawText,
                    index: matchedReference.index,
                    extractedTitle: this.extractTitle(matchedReference.rawText) || undefined,
                    extractedAuthor: this.extractAuthor(matchedReference.rawText) || undefined,
                    extractedYear: this.extractYear(matchedReference.rawText) || undefined,
                }
                : null;

            pairs.push({
                inline: {
                    text: inline.text,
                    start: inline.start,
                    end: inline.end,
                    patternType: inline.patternType,
                },
                reference: referenceData,
            });
        }

        return pairs;
    }

    /**
     * Match IEEE citations by number: [1] → Reference [1]
     */
    private static matchIEEE(
        inline: ExtractedPattern,
        references: ReferenceEntry[]
    ): ReferenceEntry | null {
        // Extract number from [1], [2], etc.
        const numberMatch = inline.text.match(/\[(\d+)\]/);
        if (!numberMatch) return null;

        const citationNumber = parseInt(numberMatch[1]);

        // Find reference with matching number
        return references.find((ref) => {
            // Check if reference starts with [1], [2], etc.
            const refNumberMatch = ref.rawText.match(/^\s*\[(\d+)\]/);
            if (refNumberMatch) {
                return parseInt(refNumberMatch[1]) === citationNumber;
            }
            // Also check for "1." format
            const refDotMatch = ref.rawText.match(/^\s*(\d+)\./);
            if (refDotMatch) {
                return parseInt(refDotMatch[1]) === citationNumber;
            }
            return false;
        }) || null;
    }

    /**
     * Match APA/MLA citations by author and year: (Smith, 2020) → Smith... (2020)
     */
    private static matchAuthorYear(
        inline: ExtractedPattern,
        references: ReferenceEntry[]
    ): ReferenceEntry | null {
        // Extract author from inline citation
        const author = this.extractAuthorFromInline(inline.text);
        const year = this.extractYearFromInline(inline.text);

        if (!author) return null;

        // Find reference with matching author (and year if available)
        return references.find((ref) => {
            const refText = ref.rawText.toLowerCase();
            const authorLower = author.toLowerCase();

            // Check if author name appears in reference
            const hasAuthor = refText.includes(authorLower);

            if (year) {
                // If we have a year, match both author and year
                return hasAuthor && refText.includes(year.toString());
            }

            // If no year in inline citation, match just by author
            return hasAuthor;
        }) || null;
    }

    /**
     * Extract author from inline citation: (Smith, 2020) → "Smith"
     */
    private static extractAuthorFromInline(text: string): string | null {
        // Remove parentheses and brackets
        const cleaned = text.replace(/[()[\]]/g, "").trim();

        // Pattern: "Author, Year" or "Author Year" or "Author et al., Year"
        const patterns = [
            /^([A-Z][a-z]+(?:\s+(?:et al\.|et al))?)(?:,|\s)\s*\d{4}/, // Smith, 2020 or Smith et al., 2020
            /^([A-Z][a-z]+)(?:,|\s)\s*\d+/, // Smith, 45 (for page numbers)
            /^([A-Z][a-z]+)/, // Just author name
        ];

        for (const pattern of patterns) {
            const match = cleaned.match(pattern);
            if (match) {
                return match[1].replace(/\s+et al\.?/, "").trim(); // Remove "et al." from author
            }
        }

        return null;
    }

    /**
     * Extract year from inline citation: (Smith, 2020) → 2020
     */
    private static extractYearFromInline(text: string): number | null {
        const yearMatch = text.match(/\b(19|20)\d{2}\b/);
        return yearMatch ? parseInt(yearMatch[0]) : null;
    }

    /**
     * Extract title from reference entry
     * Heuristic: Title is usually between first period and second period, or in quotes
     */
    private static extractTitle(refText: string): string | null {
        // CLEANUP: Remove [1], [2], etc. from start
        const cleanText = refText.replace(/^\s*\[\d+\]\s*/, "").replace(/^\s*\d+\.\s*/, "");

        // Try to find title in quotes first
        const quotedMatch = cleanText.match(/"([^"]+)"/);
        if (quotedMatch) {
            return quotedMatch[1].trim();
        }

        // Try to find title in italics (Markdown style if present) or just heuristic
        // IEEE Pattern: Author, "Title," Journal... OR Author. Title. Journal...

        // Strategy A: Split by periods (Common in APA/IEEE)
        const parts = cleanText.split(".");
        if (parts.length >= 2) {
            // Usually Part 0 is Author, Part 1 is Year (APA) or Title (IEEE)
            // If it's IEEE (usually comma separated authors), title might be after first period? 
            // Actually IEEE is often: J. K. Author, "Title of paper," Abbrev. Title...

            // Let's try to detect if it's APA-like (Date in parens)
            if (cleanText.match(/\(\d{4}\)/)) {
                // APA: Author (Date). Title.
                const afterDate = cleanText.split(/\)\.\s*/)[1];
                if (afterDate) {
                    return afterDate.split(".")[0].trim();
                }
            } else {
                // IEEE: Author. Title.
                // return parts[1].trim(); // Risky if initials have dots
            }
        }

        // Fallback: If we have quotes, we took them. If not...
        // Let's try to grab the longest segment between punctuation that isn't the author?
        // Simple fallback for now: Remove author (first 3 words?)

        // Better fallback for IEEE: Text between first comma/period and next punctuation?
        // Removing explicit heuristic that was failing.
        // Returning segments based on standard formats.

        return null; // Better to return null than "Strachan and A"
    }

    /**
     * Extract author from reference entry
     */
    private static extractAuthor(refText: string): string | null {
        // CLEANUP: Remove [1], [2], etc. from start
        const cleanText = refText.replace(/^\s*\[\d+\]\s*/, "").replace(/^\s*\d+\.\s*/, "");

        // Author is usually at the start, before first comma (IEEE) or period (APA)
        // IEEE: T. Strachan and A. Read, "Title"...
        // APA: Strachan, T., & Read, A. (2018)...

        // Split by first comma or period (but ignore periods in initials like T.)
        // Regex to find first punctuation that ISN'T an initial letter period?

        // Simple heuristic: Everything before the first open paren (Year) or Quote?
        const beforeParen = cleanText.split("(")[0];
        const beforeQuote = cleanText.split('"')[0];

        // Take the shorter of the two valid splits
        let candidate = cleanText;
        if (beforeParen.length < candidate.length && beforeParen.length > 5) candidate = beforeParen;
        if (beforeQuote.length < candidate.length && beforeQuote.length > 5) candidate = beforeQuote;

        // Remove trailing comma/period
        return candidate.replace(/[,.]+$/, "").trim();
    }

    /**
     * Extract year from reference entry
     */
    private static extractYear(refText: string): number | null {
        const yearMatch = refText.match(/\b(19|20)\d{2}\b/);
        return yearMatch ? parseInt(yearMatch[0]) : null;
    }
}
