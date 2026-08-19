// @ts-ignore - no type definitions for pdf-parse
const pdfParse = require("pdf-parse");
import { createHash } from "crypto";
import logger from "../monitoring/logger";

export interface GrobidConfig {
  endpoint: string;
  timeout: number;
}

export interface GrobidReference {
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  rawText: string;
  journal?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  publisher?: string;
}

export interface GrobidResult {
  references: GrobidReference[];
  rawXml: string;
  documentTitle?: string;
  documentAbstract?: string;
}

interface CacheEntry {
  result: GrobidResult;
  timestamp: number;
}

const DEFAULT_CONFIG: GrobidConfig = {
  endpoint: "local",
  timeout: 30000,
};

export class GrobidService {
  private static readonly cache = new Map<string, CacheEntry>();
  private static readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  private static readonly MAX_CACHE_ENTRIES = 100;

  static getConfig(): GrobidConfig {
    return { ...DEFAULT_CONFIG };
  }

  static async isAvailable(): Promise<boolean> {
    return true;
  }

  static async processPDF(
    pdfBuffer: Buffer,
    fileName: string = "document.pdf"
  ): Promise<GrobidResult | null> {
    const hash = this.computeHash(pdfBuffer);
    const cached = this.cache.get(hash);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      logger.info("[PDF-PARSE] Returning cached result for", { fileName });
      return cached.result;
    }

    try {
      logger.info("[PDF-PARSE] Processing PDF", {
        fileName,
        size: pdfBuffer.length,
      });

      const data = await pdfParse(pdfBuffer);
      const text: string = data.text || "";

      logger.info("[PDF-PARSE] Extracted text", {
        fileName,
        pages: data.numpages || 0,
        textLength: text.length,
      });

      if (!text || text.trim().length === 0) {
        logger.warn("[PDF-PARSE] Extracted text is empty", { fileName });
      }

      const documentTitle = this.extractTitle(text, fileName);
      const documentAbstract = this.extractAbstract(text);
      const references = this.extractReferences(text);

      const result: GrobidResult = {
        references,
        rawXml: text,
        documentTitle,
        documentAbstract,
      };

      this.cache.set(hash, { result, timestamp: Date.now() });
      this.evictIfNeeded();

      logger.info("[PDF-PARSE] Successfully processed PDF", {
        fileName,
        references: references.length,
      });

      return result;
    } catch (error: any) {
      logger.error("[PDF-PARSE] FAILED to process PDF", {
        fileName,
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }

  private static extractTitle(text: string, fallback: string): string {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return fallback;
    const firstLine = lines[0];
    if (firstLine.length > 10 && firstLine.length < 300) return firstLine;
    return fallback;
  }

  private static extractAbstract(text: string): string | undefined {
    const match = text.match(
      /abstract\s*[:\-—]?\s*([\s\S]*?)(?=\b(?:introduction|keywords|1\.\s))/i
    );
    if (match) {
      const abstract = match[1].replace(/\s+/g, " ").trim();
      return abstract.length > 20 ? abstract : undefined;
    }
    return undefined;
  }

  private static extractReferences(text: string): GrobidReference[] {
    const refSection = this.findReferenceSection(text);
    if (!refSection) return [];

    const entries = this.splitReferenceEntries(refSection);
    const references: GrobidReference[] = [];
    for (const entry of entries) {
      const ref = this.parseSingleReference(entry);
      if (ref) references.push(ref);
    }

    return references;
  }

  private static findReferenceSection(text: string): string | null {
    const patterns = [
      /\b(?:references|bibliography|works cited|sources)\s*\n/i,
      /\b(?:REFERENCES|BIBLIOGRAPHY|WORKS CITED)\s*\n/,
    ];
    let startIdx = -1;
    for (const pattern of patterns) {
      const match = text.search(pattern);
      if (match >= 0) { startIdx = match; break; }
    }
    if (startIdx < 0) return null;

    const sectionEnd = text.search(/\n\s*(?:appendix|acknowledgments|footnotes|supplementary)\s*\n/i);
    return text.substring(startIdx, sectionEnd > startIdx ? sectionEnd : undefined);
  }

  private static splitReferenceEntries(refSection: string): string[] {
    const body = refSection.replace(/^(?:references|bibliography|works cited)\s*\n/i, "").trim();
    if (!body) return [];

    const numberedPattern = /(?:^|\n)\s*(?:\[(\d+)\]|(\d+)\.|(\d+)\))\s*/g;
    const matches: { index: number; match: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = numberedPattern.exec(body)) !== null) {
      matches.push({ index: m.index, match: m[0] });
    }
    if (matches.length >= 2) {
      const result: string[] = [];
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index + matches[i].match.length;
        const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
        const entry = body.substring(start, end).trim();
        if (entry) result.push(entry);
      }
      return result;
    }

    const byParagraph = body.split(/\n\s*\n/).filter(p => p.trim().length > 20);
    if (byParagraph.length >= 2) return byParagraph;

    const byLine = body.split("\n").filter(l => l.trim().length > 20);
    if (byLine.length >= 1) return byLine;

    return [body];
  }

  private static parseSingleReference(text: string): GrobidReference | null {
    text = text.trim();
    if (text.length < 10) return null;

    const doi = this.extractDOI(text);
    const year = this.extractYear(text);
    const authors = this.extractAuthors(text);
    const title = this.extractTitleFromRef(text);
    const journal = this.extractJournal(text);
    const volume = this.extractVolume(text);
    const issue = this.extractIssue(text);
    const pages = this.extractPages(text);
    const publisher = this.extractPublisher(text);

    return {
      title: title || text.substring(0, 100),
      authors,
      year,
      doi,
      rawText: text,
      journal,
      volume,
      issue,
      pages,
      publisher,
    };
  }

  private static extractDOI(text: string): string | undefined {
    const match = text.match(/\b(10\.\d{4,}\/[\w\-./:()]+[\w\-])/);
    return match ? match[1].replace(/[.,;]+$/, "") : undefined;
  }

  private static extractYear(text: string): number | undefined {
    const match = text.match(/\(?(19|20)\d{2}\)?/);
    if (match) return parseInt(match[0].replace(/[()]/g, ""), 10);
    return undefined;
  }

  private static extractAuthors(text: string): string[] {
    const authors: string[] = [];
    const pattern = /([A-Z][a-zéüöä]+,\s*[A-Z](?:\.[A-Z]?\.?)?(?:\s*,\s*)?)+/g;
    const match = pattern.exec(text);
    if (match) {
      const parts = match[0].split(/\s*,\s*(?=[A-Z][a-z])/).filter(Boolean);
      for (const part of parts) {
        const clean = part.replace(/^[,.\s]+|[,.\s]+$/g, "").trim();
        if (clean && !/^(?:and|&)$/i.test(clean)) {
          authors.push(clean);
        }
      }
    }
    return [...new Set(authors)].slice(0, 10);
  }

  private static extractTitleFromRef(text: string): string | undefined {
    let clean = text.replace(/^\[?\d+\]?\.?\s*/, "");
    clean = clean.replace(/^[A-Z][a-z]+,\s*[A-Z]\.\s*(?:,\s*[A-Z][a-z]+,\s*[A-Z]\.\s*)*/, "");

    const apaMatch = clean.match(/["""'']?([A-Z][^."]{10,150}?)["""'']?\s*[.].*?(?:Journal|Review|Research|Proceedings|Letters|Transactions|Society|Medical|Science)/i);
    if (apaMatch) return apaMatch[1].trim();

    const ieeeMatch = clean.match(/["""]([^""]{10,200})["""]/);
    if (ieeeMatch) return ieeeMatch[1].trim();

    const firstSentence = clean.match(/^([A-Z][^.]{10,200}\.)/);
    if (firstSentence) return firstSentence[1].replace(/\.$/, "").trim();

    return undefined;
  }

  private static extractJournal(text: string): string | undefined {
    const match = text.match(
      /(?:[A-Z][a-z]+ (?:Journal|Review|Research|Letters|Transactions|Proceedings|Annals|Archives|International Journal|British Journal|American Journal)[A-Za-z\s,.&]*)/
    );
    return match ? match[1].trim() : undefined;
  }

  private static extractVolume(text: string): string | undefined {
    const match = text.match(/\b(?:vol\.?\s*|volume\s+)(\d+)/i);
    return match ? match[1] : undefined;
  }

  private static extractIssue(text: string): string | undefined {
    const match = text.match(/(?:no\.?\s*|number\s+|issue\s+)(\d+)/i);
    return match ? match[1] : undefined;
  }

  private static extractPages(text: string): string | undefined {
    const match = text.match(/(?:pp?\.?\s*)?(\d{2,4}\s*[–\-—]\s*\d{2,4})/);
    return match ? match[1] : undefined;
  }

  private static extractPublisher(text: string): string | undefined {
    const publishers = [
      "Elsevier", "Springer", "Wiley", "Taylor & Francis", "SAGE",
      "Oxford University Press", "Cambridge University Press", "IEEE",
      "ACM", "PLOS", "MDPI", "Frontiers", "Nature Publishing Group",
      "Emerald", "De Gruyter", "University of Chicago Press", "MIT Press",
    ];
    for (const pub of publishers) {
      if (text.includes(pub)) return pub;
    }
    return undefined;
  }

  private static computeHash(buffer: Buffer): string {
    return createHash("sha256").update(buffer).digest("hex");
  }

  private static evictIfNeeded(): void {
    if (this.cache.size <= this.MAX_CACHE_ENTRIES) return;
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.CACHE_TTL_MS) {
        this.cache.delete(key);
      }
    }
  }

  static clearCache(): void {
    this.cache.clear();
  }
}
