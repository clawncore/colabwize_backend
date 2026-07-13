"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CitationMatcher = void 0;
/**
 * Citation Matcher - Links inline citations to their reference entries
 */
class CitationMatcher {
    /**
     * Match inline citations to reference entries based on citation style
     */
    static matchCitations(inlineCitations, referenceEntries, style) {
        const pairs = [];
        // Auto-detect whether citations are numeric [1] or author-year (Smith, 2020)
        // by checking the first few citations. If the majority look like numeric
        // brackets, use index-based matching regardless of declared style.
        const sampleSize = Math.min(inlineCitations.length, 5);
        let numericCount = 0;
        for (let i = 0; i < sampleSize; i++) {
            if (/^\s*\[\d+\]\s*$/.test(inlineCitations[i].text) || /^\s*\(\d+\)\s*$/.test(inlineCitations[i].text)) {
                numericCount++;
            }
        }
        const isNumericStyle = numericCount >= Math.ceil(sampleSize / 2);
        for (const inline of inlineCitations) {
            let matchedReference = null;
            if (isNumericStyle || style === "IEEE") {
                // Numeric: Match by number [1], [2], etc.
                matchedReference = this.matchIEEE(inline, referenceEntries);
            }
            else if (style === "APA" || style === "MLA") {
                // APA/MLA: Match by author and year
                matchedReference = this.matchAuthorYear(inline, referenceEntries);
            }
            else {
                // Fallback: try numeric first, then author-year
                matchedReference = this.matchIEEE(inline, referenceEntries);
                if (!matchedReference) {
                    matchedReference = this.matchAuthorYear(inline, referenceEntries);
                }
            }
            // Extract metadata from reference if found
            const referenceData = matchedReference
                ? {
                    rawText: matchedReference.rawText,
                    index: matchedReference.index,
                    extractedTitle: this.extractTitle(matchedReference.rawText) || undefined,
                    extractedAuthor: this.extractAuthor(matchedReference.rawText) || undefined,
                    extractedYear: this.extractYear(matchedReference.rawText) || undefined,
                    extractedDOI: this.extractDOI(matchedReference.rawText) || undefined,
                }
                : null;
            pairs.push({
                inline: {
                    text: inline.text,
                    start: inline.start,
                    end: inline.end,
                    patternType: inline.patternType,
                    context: inline.context,
                },
                reference: referenceData,
            });
        }
        return pairs;
    }
    /**
     * Match IEEE citations by number: [1] → Reference [1]
     */
    static matchIEEE(inline, references) {
        // Extract number from [1], [2], etc.
        const numberMatch = inline.text.match(/\[(\d+)\]/);
        if (!numberMatch)
            return null;
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
    static matchAuthorYear(inline, references) {
        // Extract author from inline citation
        const author = this.extractAuthorFromInline(inline.text);
        const year = this.extractYearFromInline(inline.text);
        if (!author)
            return null;
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
    static extractAuthorFromInline(text) {
        // Remove parentheses and brackets
        const cleaned = text.replace(/[()[\]]/g, "").trim();
        // Pattern: "Author, Year" or "Author & Author, Year" or "Author et al., Year"
        // Try to get the first author name specifically
        const firstAuthorMatch = cleaned.match(/^([A-Z][a-z]+)/);
        if (firstAuthorMatch) {
            return firstAuthorMatch[1].trim();
        }
        return null;
    }
    /**
     * Extract year from inline citation: (Smith, 2020) → 2020
     */
    static extractYearFromInline(text) {
        // Look for 4 digits that start with 19 or 20
        const yearMatch = text.match(/\b(19|20)\d{2}\b/);
        return yearMatch ? parseInt(yearMatch[0]) : null;
    }
    /**
     * Extract title from reference entry
     * Heuristic: Title is usually between first period and second period, or in quotes
     */
    static extractTitle(refText) {
        // CLEANUP: Remove [1], [2], etc. from start
        const cleanText = refText.replace(/^\s*\[\d+\]\s*/, "").replace(/^\s*\d+\.\s*/, "");
        // Strategy 1: Title in quotes (common in IEEE/Chicago)
        const quotedMatch = cleanText.match(/"([^"]+)"/);
        if (quotedMatch) {
            return quotedMatch[1].trim();
        }
        // Strategy 2: Title in single quotes
        const singleQuoted = cleanText.match(/'([^']+)'/);
        if (singleQuoted) {
            return singleQuoted[1].trim();
        }
        // Strategy 3: APA format — Author(s) (Year). Title. ...
        // After the year-in-parentheses, the title is the next sentence-like segment
        const apaMatch = cleanText.match(/\(\d{4}[a-z]?\)\.\s*([^.]+)/);
        if (apaMatch) {
            return apaMatch[1].trim();
        }
        // Strategy 4: Author-Year without period after parens — Author (Year) Title
        const apaNoPeriod = cleanText.match(/\(\d{4}[a-z]?\)\s+([^.]+)/);
        if (apaNoPeriod) {
            return apaNoPeriod[1].trim();
        }
        // Strategy 5: IEEE format — Author, "Title," Journal
        // Text between first comma and next comma that looks like a title
        const ieeeComma = cleanText.match(/,\s*([^,]{10,80}),/);
        if (ieeeComma) {
            const candidate = ieeeComma[1].trim();
            // Make sure it doesn't look like a year or number
            if (!/^\d+$/.test(candidate) && candidate.length > 5) {
                return candidate;
            }
        }
        // Strategy 6: Split by ". " (period + space) and take the longest
        // segment that isn't the first (author) and isn't too short
        const segments = cleanText.split(/\.\s+/);
        if (segments.length >= 2) {
            // Skip first segment (usually author), find longest remaining
            let best = "";
            for (let i = 1; i < segments.length; i++) {
                const seg = segments[i].trim();
                if (seg.length > best.length && seg.length > 10 && !/^(19|20)\d{2}$/.test(seg)) {
                    best = seg;
                }
            }
            if (best)
                return best;
        }
        return null;
    }
    /**
     * Extract author from reference entry
     */
    static extractAuthor(refText) {
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
        if (beforeParen.length < candidate.length && beforeParen.length > 5)
            candidate = beforeParen;
        if (beforeQuote.length < candidate.length && beforeQuote.length > 5)
            candidate = beforeQuote;
        // Remove trailing comma/period
        return candidate.replace(/[,.]+$/, "").trim();
    }
    /**
     * Extract year from reference entry
     */
    static extractYear(refText) {
        const yearMatch = refText.match(/\b(19|20)\d{2}\b/);
        return yearMatch ? parseInt(yearMatch[0]) : null;
    }
    /**
     * Extract DOI from reference entry
     */
    static extractDOI(refText) {
        // Broad DOI regex
        const doiRegex = /\b(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)\b/i;
        const match = refText.match(doiRegex);
        return match ? match[1] : null;
    }
}
exports.CitationMatcher = CitationMatcher;
