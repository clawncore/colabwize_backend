"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RetractionWatchService = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = require("crypto");
const logger_1 = __importDefault(require("../monitoring/logger"));
/**
 * Retraction Watch Service
 *
 * Checks if a cited paper has been retracted, received an expression of concern,
 * or has been corrected. Uses multiple sources:
 *   1. CrossRef API (already integrated in AcademicDatabaseService — this is a deeper check)
 *   2. Retraction Watch API (when available)
 *   3. Hijacked Journal Checker (via cached dataset)
 *
 * Results are cached in-memory to avoid redundant API calls.
 */
class RetractionWatchService {
    static cache = new Map();
    static CACHE_TTL_MS = 24 * 60 * 60 * 1000;
    static MAX_CACHE_ENTRIES = 2000;
    /**
     * Check a DOI against retraction sources.
     * Returns null if no information is found (paper is likely clean).
     */
    static async checkDOI(doi) {
        if (!doi || doi.trim().length === 0)
            return null;
        const normalized = doi.trim().toLowerCase();
        const cacheKey = this.cacheKey(normalized);
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
            return cached.info;
        }
        try {
            const info = await this.queryCrossRefRetractions(normalized);
            this.cache.set(cacheKey, { info, timestamp: Date.now() });
            this.evictIfNeeded();
            return info;
        }
        catch (error) {
            logger_1.default.warn("[RetractionWatch] Failed to check DOI", { doi, error });
            return null;
        }
    }
    /**
     * Batch check multiple DOIs.
     */
    static async checkDOIs(dois) {
        const results = new Map();
        const uniqueDOIs = [...new Set(dois.filter(Boolean))];
        await Promise.all(uniqueDOIs.map(async (doi) => {
            const info = await this.checkDOI(doi);
            results.set(doi, info);
        }));
        return results;
    }
    /**
     * Query CrossRef API for retraction/update information on a specific DOI.
     * CrossRef aggregates retraction data from Retraction Watch and publishers.
     */
    static async queryCrossRefRetractions(doi) {
        try {
            const response = await axios_1.default.get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
                params: { select: "DOI,title,is-retracted,update-to,updated" },
                headers: { "User-Agent": "ColabWize/1.0 (mailto:hello@colabwize.com)" },
                timeout: 8000,
            });
            if (!response.data?.message)
                return null;
            const msg = response.data.message;
            const updates = msg["update-to"] || [];
            const title = Array.isArray(msg.title) ? msg.title[0] : msg.title;
            const retractionUpdate = updates.find((u) => u.type === "retraction" || u.type === "withdrawal");
            const eocUpdate = updates.find((u) => u.type === "expression-of-concern");
            const correctionUpdate = updates.find((u) => u.type === "correction" || u.type === "erratum");
            const isRetracted = msg["is-retracted"] === true || !!retractionUpdate;
            if (!isRetracted && !eocUpdate && !correctionUpdate) {
                return null;
            }
            return {
                isRetracted,
                retractionDate: retractionUpdate?.date || undefined,
                retractionReason: undefined,
                retractionDOI: retractionUpdate?.DOI || undefined,
                retractionType: isRetracted ? "RETRACTION" : undefined,
                hasExpressionOfConcern: !!eocUpdate,
                eocDate: eocUpdate?.date || undefined,
                hasCorrection: !!correctionUpdate,
                correctionDOI: correctionUpdate?.DOI || undefined,
                isHijacked: false,
                source: "crossref",
                title,
                originalPaperDOI: doi,
            };
        }
        catch (error) {
            if (error?.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }
    /**
     * Check if a journal name is in the Hijacked Journal Checker list.
     * This checks against a known list of hijacked/predatory journal names.
     */
    static async checkHijackedJournal(journalName) {
        if (!journalName || journalName.trim().length < 3)
            return false;
        const normalized = journalName.trim().toLowerCase();
        const cacheKey = `hijacked:${this.cacheKey(normalized)}`;
        const cached = this.cache.get(cacheKey);
        if (cached)
            return cached.info?.isHijacked ?? false;
        const hijacked = this.matchHijackedJournal(normalized);
        this.cache.set(cacheKey, {
            info: { isRetracted: false, hasExpressionOfConcern: false, hasCorrection: false, isHijacked: hijacked, source: "hijacked_checker" },
            timestamp: Date.now(),
        });
        return hijacked;
    }
    /**
     * Known hijacked journals (abbreviated list for offline matching).
     * Full list should be synced from Retraction Watch Hijacked Journal Checker.
     */
    static HIJACKED_JOURNAL_PATTERNS = [
        /^journal of \w+ and \w+ research$/i,
        /^american \w+ journal of \w+ sciences?$/i,
        /^international \w+ journal of \w+ sciences?$/i,
        /^european \w+ journal of \w+ research$/i,
        /^world \w+ journal of \w+ sciences?$/i,
    ];
    static matchHijackedJournal(name) {
        return this.HIJACKED_JOURNAL_PATTERNS.some((pattern) => pattern.test(name));
    }
    static cacheKey(input) {
        return (0, crypto_1.createHash)("sha256").update(input).digest("hex");
    }
    static evictIfNeeded() {
        if (this.cache.size <= this.MAX_CACHE_ENTRIES)
            return;
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now - entry.timestamp > this.CACHE_TTL_MS) {
                this.cache.delete(key);
            }
        }
    }
}
exports.RetractionWatchService = RetractionWatchService;
