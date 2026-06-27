import { createHash } from "crypto";

// ─── Types (mirror src/services/citationMatcher.ts — keep in sync) ────────

export interface CitationEntity {
  id: string;
  originalText: string;
  type: "ieee" | "apa" | "mla" | "chicago";
  year?: string;
  authorLabel?: string;
  page?: string;
  ieeeNumber?: number;
}

// ─── Pure helpers (inlined from src/services/citationMatcher.ts) ──────────

function normalizeAuthor(name: string): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/[\s'-]/g, "")
    .replace(/^(van|von|de|del|della|di|du|la|le|el)\s+/, "");
}

export function extractAuthors(referenceText: string): string[] {
  if (!referenceText) return [];
  const cleaned = referenceText.replace(/^[\[\(]?\d+[\]\)\.\s:]+/, "").trim();
  if (!cleaned) return [];

  const yearMatch = cleaned.match(/\((\d{4}[a-z]?)\)/) || cleaned.match(/\b(19|20)\d{2}\b/);
  let authorRegion: string;
  if (yearMatch && yearMatch.index) {
    authorRegion = cleaned.substring(0, yearMatch.index);
  } else {
    const firstPeriod = cleaned.search(/\.\s/);
    authorRegion = firstPeriod > 0 ? cleaned.substring(0, firstPeriod) : cleaned;
  }

  const splitOnAmpersand = authorRegion.split(/\s+&\s+|\s+and\s+/);
  const rawAuthors: string[] = [];
  for (const segment of splitOnAmpersand) {
    const parts = segment.split(/,\s*(?=[A-Z])/);
    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed) rawAuthors.push(trimmed);
    }
  }

  return rawAuthors.map((author) => {
    const commaIdx = author.indexOf(",");
    const surname = commaIdx > 0 ? author.substring(0, commaIdx).trim() : author.trim();
    return normalizeAuthor(surname);
  }).filter(Boolean);
}

const YEAR_REGEX = /\b(19|20)\d{2}[a-z]?\b/;

export function extractYear(text: string): string | null {
  const match = text.match(YEAR_REGEX);
  return match ? match[0] : null;
}

export function extractIEEEFromReference(referenceText: string): number | null {
  const match = referenceText.match(/^\[?(\d+)\]?[\.\s]/);
  return match ? parseInt(match[1], 10) : null;
}

export function parseReferenceLine(rawText: string, id: string): CitationEntity {
  const trimmed = rawText.trim();
  const ieeeNumber = extractIEEEFromReference(trimmed);
  const type = ieeeNumber !== null ? "ieee" : detectFallbackType(trimmed);
  const year = extractYear(trimmed);
  const authors = extractAuthors(trimmed);

  return {
    id,
    originalText: trimmed,
    type,
    year: year || undefined,
    authorLabel: authors[0] || undefined,
    ieeeNumber: ieeeNumber || undefined,
  };
}

function detectFallbackType(text: string): "ieee" | "apa" {
  return /^\[\d+\]|^\d+\./.test(text) ? "ieee" : "apa";
}

// ─── Types ────────────────────────────────────────────────────────────────

interface SplitResult {
  bodyText: string;
  bibliographyText: string;
}

interface ParseResult {
  bodyJson: any;
  usedEntities: Map<string, CitationEntity>;
  allEntities: CitationEntity[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Generate a stable, content-derived ID for a reference.
 * Re-uploading the same document produces the same UUIDs.
 */
function stableId(referenceText: string): string {
  return createHash("sha1").update(referenceText.trim()).digest("hex").substring(0, 36);
}

/**
 * Strip HTML tags while preserving paragraph boundaries.
 * "<p>Hello</p><p>World</p>" → "Hello\nWorld"
 */
function stripHtmlPreserveParagraphs(html: string): string {
  return html
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// ─── Main Service ─────────────────────────────────────────────────────────

export class CitationMappingService {
  /**
   * Main entry point.
   * Takes raw HTML/Text from an uploaded document and returns Tiptap JSON
   * with `citation` and `bibliographyEntry` nodes linked by stable UUIDs.
   */
  static parseDocument(rawContent: string, format: "html" | "text"): any {
    const { bodyText, bibliographyText } = this.splitBibliography(rawContent, format);
    const allEntities = this.parseBibliography(bibliographyText);
    const { bodyJson, usedEntities } = this.mapInTextCitationsToJSON(bodyText, allEntities);
    return this.appendBibliographyToJSON(bodyJson, usedEntities, allEntities);
  }

  /**
   * Splits the raw document into main body and bibliography section.
   * Scans from the bottom up to find "References", "Bibliography", or "Works Cited".
   * Scans up to the last 30% of the document (max 1000 lines).
   */
  private static splitBibliography(content: string, format: "html" | "text"): SplitResult {
    const lines = content.split("\n");

    // Strip HTML tags for the heading check, but keep original lines for content
    const cleanLines = format === "html"
      ? lines.map((l) => stripHtmlPreserveParagraphs(l))
      : lines;

    // Scan bottom-up: last 30% of lines, max 1000 lines, min 10 lines
    const scanWindow = Math.max(10, Math.min(1000, Math.ceil(lines.length * 0.3)));
    const scanLimit = Math.max(0, lines.length - scanWindow);

    let splitIndex = -1;
    for (let i = cleanLines.length - 1; i >= scanLimit; i--) {
      const cleanLine = cleanLines[i].trim().toLowerCase();
      if (
        (cleanLine === "references" ||
          cleanLine === "bibliography" ||
          cleanLine === "works cited" ||
          cleanLine === "reference list") &&
        cleanLines[i].trim().length < 30
      ) {
        splitIndex = i;
        break;
      }
    }

    if (splitIndex === -1) {
      return { bodyText: content, bibliographyText: "" };
    }

    const bodyText = lines.slice(0, splitIndex).join("\n");
    const bibliographyText = lines.slice(splitIndex + 1).join("\n");

    return { bodyText, bibliographyText };
  }

  /**
   * Parses the bibliography text block into CitationEntities.
   * Each entity gets a stable ID derived from its text content.
   */
  private static parseBibliography(bibText: string): CitationEntity[] {
    if (!bibText.trim()) return [];

    const entities: CitationEntity[] = [];
    const rawRefs = bibText.split(/\n\s*\n|\n(?=\[\d+\])|\n(?=\d+\.)/);

    for (const ref of rawRefs) {
      const trimmed = ref.trim();
      if (!trimmed) continue;

      // Strip HTML for the content check
      const cleanRef = stripHtmlPreserveParagraphs(trimmed);
      if (cleanRef.length < 10) continue;

      const entity = parseReferenceLine(cleanRef, stableId(cleanRef));
      entities.push(entity);
    }

    return entities;
  }

  /**
   * Scans the body text for citation patterns and maps them to bibliography entities.
   * Uses the citationMatcher module for consistent matching logic.
   */
  private static mapInTextCitationsToJSON(
    bodyText: string,
    bibliographyEntities: CitationEntity[],
  ): { bodyJson: any; usedEntities: Map<string, CitationEntity> } {
    const usedEntities = new Map<string, CitationEntity>();

    // Build IEEE number→entity map
    const ieeeMap = new Map<number, CitationEntity>();
    for (const entity of bibliographyEntities) {
      if (entity.ieeeNumber !== undefined) {
        ieeeMap.set(entity.ieeeNumber, entity);
      }
    }

    // Build author+year index for APA/Chicago
    const authorYearIndex = new Map<string, CitationEntity[]>();
    for (const entity of bibliographyEntities) {
      if (entity.type === "apa" || entity.type === "chicago") {
        const key = `${entity.authorLabel || ""}__${entity.year || ""}`;
        const existing = authorYearIndex.get(key) || [];
        existing.push(entity);
        authorYearIndex.set(key, existing);
      }
    }

    // Split body into paragraphs
    const paragraphs = bodyText.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

    const bodyJson = {
      type: "doc",
      content: [] as any[],
    };

    // IEEE pattern: [N] or [N-M] or [N, M]
    const IEEE_REGEX = /\[\s*\d+(?:[\s,-]+\d+)*\s*\]/g;
    // APA pattern: (Author, Year)
    const APA_REGEX = /\([A-Z][^()]{1,50}(?:,\s*(?:19|20)\d{2}[a-z]?)(?:\s*,?\s*[^)]*)?\)/g;
    // Chicago pattern: (Author Year) — no comma
    const CHICAGO_REGEX = /\([A-Z][a-zÀ-ÿ-]+(?:\s+et al\.)?\s+(?:19|20)\d{2}[a-z]?\)/g;

    for (const p of paragraphs) {
      if (!p.trim()) continue;

      const textContent = stripHtmlPreserveParagraphs(p);
      const paragraphNode = {
        type: "paragraph",
        content: [] as any[],
      };

      // Collect all matches with their positions
      const matches: Array<{ type: "ieee" | "apa" | "chicago"; text: string; start: number; end: number }> = [];

      let match: RegExpExecArray | null;

      // IEEE
      IEEE_REGEX.lastIndex = 0;
      while ((match = IEEE_REGEX.exec(textContent)) !== null) {
        matches.push({ type: "ieee", text: match[0], start: match.index, end: match.index + match[0].length });
      }

      // APA
      APA_REGEX.lastIndex = 0;
      while ((match = APA_REGEX.exec(textContent)) !== null) {
        matches.push({ type: "apa", text: match[0], start: match.index, end: match.index + match[0].length });
      }

      // Chicago (only if not already matched as APA)
      CHICAGO_REGEX.lastIndex = 0;
      while ((match = CHICAGO_REGEX.exec(textContent)) !== null) {
        // Check this position isn't already covered by an APA match
        const overlaps = matches.some(
          (m) => match!.index >= m.start && match!.index < m.end
        );
        if (!overlaps) {
          matches.push({ type: "chicago", text: match[0], start: match.index, end: match.index + match[0].length });
        }
      }

      // Expand compound IEEE citations like [3,4] or [1-3] into individual
      // references so each number gets its own citation node.
      const expandedMatches = expandIEEEMatches(matches, ieeeMap);

      // Sort by position
      expandedMatches.sort((a, b) => a.start - b.end);

      let lastIndex = 0;

      for (const m of expandedMatches) {
        // Add text before the citation
        if (m.start > lastIndex) {
          paragraphNode.content.push({
            type: "text",
            text: textContent.substring(lastIndex, m.start),
          });
        }

        if (m.mappedEntity) {
          usedEntities.set(m.mappedEntity.id, m.mappedEntity);
          paragraphNode.content.push({
            type: "citation",
            attrs: {
              citationId: m.mappedEntity.id,
              text: m.text,
            },
          });
        } else {
          // No match — keep as plain text
          paragraphNode.content.push({
            type: "text",
            text: m.text,
          });
        }

        lastIndex = m.end;
      }

      // Add trailing text
      if (lastIndex < textContent.length) {
        paragraphNode.content.push({
          type: "text",
          text: textContent.substring(lastIndex),
        });
      }

      if (paragraphNode.content.length > 0) {
        bodyJson.content.push(paragraphNode);
      }
    }

    return { bodyJson, usedEntities };
  }

  /**
   * Appends bibliography entries to the end of the JSON document.
   * Includes ALL entities (not just used ones), with `matched` flag.
   */
  private static appendBibliographyToJSON(
    bodyJson: any,
    usedEntities: Map<string, CitationEntity>,
    allEntities: CitationEntity[],
  ): any {
    if (allEntities.length === 0) return bodyJson;

    bodyJson.content.push({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "References" }],
    });

    for (const entity of allEntities) {
      bodyJson.content.push({
        type: "bibliographyEntry",
        attrs: {
          citationId: entity.id,
          matched: usedEntities.has(entity.id),
        },
        content: [
          {
            type: "text",
            text: entity.originalText,
          },
        ],
      });
    }

    return bodyJson;
  }
}

// ─── IEEE compound citation expansion (backend) ────────────────────────────

/**
 * Expand compound IEEE citations like [3,4] or [1-3] into individual matches.
 * Each number gets its own entry with the correct ieeeMap lookup.
 *
 * Non-IEEE matches and single-number IEEE matches pass through unchanged.
 */
function expandIEEEMatches(
  matches: Array<{ type: "ieee" | "apa" | "chicago"; text: string; start: number; end: number }>,
  ieeeMap: Map<number, CitationEntity>,
): Array<{ type: "ieee" | "apa" | "chicago"; text: string; start: number; end: number; mappedEntity?: CitationEntity }> {
  const result: Array<{ type: "ieee" | "apa" | "chicago"; text: string; start: number; end: number; mappedEntity?: CitationEntity }> = [];

  for (const m of matches) {
    if (m.type !== "ieee") {
      // APA/Chicago: resolve normally
      const yearMatch = m.text.match(/\b(19|20)\d{2}[a-z]?\b/);
      const year = yearMatch ? yearMatch[0] : "";
      const authorRaw = m.text.match(/\(([A-Z][a-zA-ZÀ-ÿ'-]+)/);
      const author = authorRaw ? authorRaw[1].toLowerCase() : "";
      // For non-IEEE, we'd need the authorYearIndex here — but this function
      // only handles IEEE expansion. Non-IEEE matches pass through without mappedEntity.
      result.push(m);
      continue;
    }

    // Extract all numbers from the IEEE citation
    const innerMatch = m.text.match(/^\[([\d\s,\-]+)\]$/);
    if (!innerMatch) {
      // Single number like [1] — look up directly
      const numMatch = m.text.match(/\d+/);
      if (numMatch) {
        const num = parseInt(numMatch[0], 10);
        const entity = ieeeMap.get(num);
        result.push({ ...m, mappedEntity: entity });
      } else {
        result.push(m);
      }
      continue;
    }

    const parts = innerMatch[1].split(/[,\s]+/).filter(Boolean);
    const numbers: number[] = [];
    for (const part of parts) {
      const range = part.split("-");
      if (range.length === 2) {
        const start = parseInt(range[0], 10);
        const end = parseInt(range[1], 10);
        if (start && end && start <= end) {
          for (let n = start; n <= end; n++) numbers.push(n);
        }
      } else {
        const n = parseInt(part, 10);
        if (n) numbers.push(n);
      }
    }

    if (numbers.length <= 1) {
      // Single number — look up directly
      const entity = numbers.length === 1 ? ieeeMap.get(numbers[0]) : undefined;
      result.push({ ...m, mappedEntity: entity });
      continue;
    }

    // Multiple numbers — expand into sub-ranges
    let searchStart = 0;
    let expanded = true;
    for (const num of numbers) {
      const numStr = String(num);
      const idx = m.text.indexOf(numStr, searchStart);
      if (idx === -1) {
        expanded = false;
        break;
      }

      // Include surrounding brackets
      let start = idx;
      let end = idx + numStr.length;
      if (start > 0 && m.text[start - 1] === "[") start--;
      if (end < m.text.length && m.text[end] === "]") end++;

      const entity = ieeeMap.get(num);
      result.push({
        type: "ieee",
        text: m.text.substring(start, end),
        start: m.start + start,
        end: m.start + end,
        mappedEntity: entity,
      });

      searchStart = end;
    }

    if (!expanded) {
      // Fallback: couldn't expand, keep original
      result.push(m);
    }
  }

  return result;
}
