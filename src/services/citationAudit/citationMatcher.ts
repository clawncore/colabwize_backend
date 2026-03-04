import {
  ExtractedPattern,
  ReferenceEntry,
  CitationStyle,
} from "../../types/citationAudit";

export interface SimpleCitationPair {
  inline: ExtractedPattern;
  reference?: ReferenceEntry;
}

export class CitationMatcher {
  /**
   * Matches inline citation patterns to bibliography/reference entries.
   * Uses normalization IDs if available, with fallbacks for manual styles.
   */
  static matchCitations(
    patterns: ExtractedPattern[],
    entries: ReferenceEntry[],
    style: CitationStyle,
    citationLibrary?: Record<string, any>,
  ): SimpleCitationPair[] {
    return patterns.map((pattern) => {
      let matchedEntry: ReferenceEntry | undefined;

      // 1. Normalization-Based Match (High Confidence)
      // If the pattern has a citationId that maps to a library entry,
      // we try to find a reference entry that matches that library metadata.
      if (
        pattern.citationId &&
        citationLibrary &&
        citationLibrary[pattern.citationId]
      ) {
        const metadata = citationLibrary[pattern.citationId];

        // Search bibliography for a match by title or author/year
        matchedEntry = entries.find((entry) => {
          const lowText = entry.rawText.toLowerCase();

          // Simple fuzzy match for metadata in the raw reference text
          if (metadata.title && lowText.includes(metadata.title.toLowerCase()))
            return true;
          if (metadata.DOI && lowText.includes(metadata.DOI.toLowerCase()))
            return true;

          if (metadata.authors && metadata.authors.length > 0) {
            const firstAuthor = metadata.authors[0].toLowerCase();
            if (
              lowText.includes(firstAuthor) &&
              metadata.year &&
              lowText.includes(metadata.year.toString())
            ) {
              return true;
            }
          }

          return false;
        });
      }

      // 2. Style-Specific Fallback (Deterministic)
      if (!matchedEntry) {
        if (style === "IEEE" || pattern.patternType === "NUMERIC_BRACKET") {
          // Numeric matching: [1] -> entry 1
          const numMatch = pattern.text.match(/\d+/);
          if (numMatch) {
            const index = parseInt(numMatch[0]);
            matchedEntry = entries.find((e) => e.index === index);
          }
        } else {
          // Author-Year matching: (Smith, 2020)
          const authorMatch = pattern.text.match(/\(?([A-Z][a-zA-Z]+)/);
          const yearMatch = pattern.text.match(/(19|20)\d{2}/);

          if (authorMatch && yearMatch) {
            const author = authorMatch[1].toLowerCase();
            const year = yearMatch[0];

            matchedEntry = entries.find((entry) => {
              const lowText = entry.rawText.toLowerCase();
              return lowText.includes(author) && lowText.includes(year);
            });
          }
        }
      }

      return {
        inline: pattern,
        reference: matchedEntry,
      };
    });
  }
}
