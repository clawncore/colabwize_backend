"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MissingLinkService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_1 = __importDefault(require("../monitoring/logger"));
class MissingLinkService {
    // API endpoints
    static CROSSREF_API = "https://api.crossref.org/works";
    static PUBMED_API = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
    static ARXIV_API = "http://export.arxiv.org/api/query";
    /**
     * Main function to suggest papers based on keywords and field
     */
    static async suggestPapers(keywords, field = "default", limit = 3) {
        try {
            logger_1.default.info("Finding paper suggestions", { keywords, field, limit });
            const query = keywords.join(" ");
            const currentYear = new Date().getFullYear();
            // Search all APIs in parallel
            const [crossrefPapers, pubmedPapers, arxivPapers] = await Promise.allSettled([
                this.searchCrossRef(query, limit * 2),
                field === "medicine" || field === "biology"
                    ? this.searchPubMed(query, limit * 2)
                    : Promise.resolve([]),
                field === "computer_science" ||
                    field === "physics" ||
                    field === "mathematics"
                    ? this.searchArxiv(query, limit * 2)
                    : Promise.resolve([]),
            ]);
            // Combine results
            const allPapers = [
                ...(crossrefPapers.status === "fulfilled" ? crossrefPapers.value : []),
                ...(pubmedPapers.status === "fulfilled" ? pubmedPapers.value : []),
                ...(arxivPapers.status === "fulfilled" ? arxivPapers.value : []),
            ];
            // Deduplicate
            const uniquePapers = this.deduplicatePapers(allPapers);
            // Filter recent papers (last 3 years)
            const recentPapers = uniquePapers.filter((paper) => paper.year >= currentYear - 3);
            // Rank by relevance
            const rankedPapers = this.rankPapers(recentPapers, keywords);
            // Format and return top results
            const suggestions = rankedPapers.slice(0, limit).map((paper) => ({
                ...paper,
                citation: this.formatCitation(paper, "APA"),
            }));
            logger_1.default.info(`Found ${suggestions.length} paper suggestions`);
            return suggestions;
        }
        catch (error) {
            logger_1.default.error("Error suggesting papers", { error: error.message });
            throw new Error(`Failed to suggest papers: ${error.message}`);
        }
    }
    /**
     * Search CrossRef API
     */
    static async searchCrossRef(query, limit) {
        try {
            const response = await axios_1.default.get(this.CROSSREF_API, {
                params: {
                    query,
                    rows: limit,
                    sort: "published",
                    order: "desc",
                    filter: "type:journal-article",
                },
                timeout: 5000,
            });
            if (!response.data?.message?.items) {
                return [];
            }
            return response.data.message.items.map((item) => {
                let year = item.published?.["date-parts"]?.[0]?.[0] || new Date().getFullYear();
                // Sanity check for future years
                if (year > new Date().getFullYear() + 1) {
                    year = new Date().getFullYear();
                }
                return {
                    title: item.title?.[0] || "Untitled",
                    authors: item.author
                        ?.map((a) => {
                        const given = a.given || "";
                        const family = a.family || "";
                        const name = `${given} ${family}`.trim();
                        return name || "Unknown";
                    })
                        .filter((name) => name !== "Unknown") || [],
                    year,
                    doi: item.DOI,
                    abstract: item.abstract || undefined,
                    citationCount: item["is-referenced-by-count"] || 0,
                    journal: item["container-title"]?.[0] || undefined,
                    url: item.URL || `https://doi.org/${item.DOI}`,
                    source: "crossref",
                };
            });
        }
        catch (error) {
            logger_1.default.warn("CrossRef search failed", { error: error.message });
            return [];
        }
    }
    /**
     * Search PubMed API
     */
    static async searchPubMed(query, limit) {
        try {
            // Step 1: Search for IDs
            const searchResponse = await axios_1.default.get(`${this.PUBMED_API}/esearch.fcgi`, {
                params: {
                    db: "pubmed",
                    term: query,
                    retmax: limit,
                    sort: "pub_date",
                    retmode: "json",
                },
                timeout: 5000,
            });
            const ids = searchResponse.data?.esearchresult?.idlist || [];
            if (ids.length === 0) {
                return [];
            }
            // Step 2: Fetch details
            const detailsResponse = await axios_1.default.get(`${this.PUBMED_API}/esummary.fcgi`, {
                params: {
                    db: "pubmed",
                    id: ids.join(","),
                    retmode: "json",
                },
                timeout: 5000,
            });
            const results = detailsResponse.data?.result || {};
            return ids
                .map((id) => {
                const item = results[id];
                if (!item)
                    return null;
                return {
                    title: item.title || "Untitled",
                    authors: item.authors?.map((a) => a.name) || [],
                    year: parseInt(item.pubdate?.split(" ")[0]) || new Date().getFullYear(),
                    doi: item.elocationid?.replace("doi: ", "") || undefined,
                    journal: item.source || undefined,
                    url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
                    source: "pubmed",
                };
            })
                .filter(Boolean);
        }
        catch (error) {
            logger_1.default.warn("PubMed search failed", { error: error.message });
            return [];
        }
    }
    /**
     * Search Arxiv API
     */
    static async searchArxiv(query, limit) {
        try {
            const response = await axios_1.default.get(this.ARXIV_API, {
                params: {
                    search_query: `all:${query}`,
                    max_results: limit,
                    sortBy: "submittedDate",
                    sortOrder: "descending",
                },
                timeout: 5000,
            });
            // Parse XML response
            const entries = this.parseArxivXML(response.data);
            return entries;
        }
        catch (error) {
            logger_1.default.warn("Arxiv search failed", { error: error.message });
            return [];
        }
    }
    /**
     * Parse Arxiv XML response
     */
    static parseArxivXML(xml) {
        try {
            const entries = [];
            const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
            let match;
            while ((match = entryRegex.exec(xml)) !== null) {
                const entry = match[1];
                const title = entry.match(/<title>(.*?)<\/title>/)?.[1]?.trim() || "Untitled";
                const published = entry.match(/<published>(.*?)<\/published>/)?.[1] || "";
                const year = parseInt(published.split("-")[0]) || new Date().getFullYear();
                const id = entry.match(/<id>(.*?)<\/id>/)?.[1] || "";
                const summary = entry.match(/<summary>(.*?)<\/summary>/)?.[1]?.trim();
                // Extract authors
                const authorMatches = entry.matchAll(/<name>(.*?)<\/name>/g);
                const authors = Array.from(authorMatches).map((m) => m[1].trim());
                entries.push({
                    title,
                    authors,
                    year,
                    abstract: summary,
                    url: id,
                    source: "arxiv",
                    relevanceScore: 0, // Default relevance score
                    citation: "", // Will be populated later
                });
            }
            return entries;
        }
        catch (error) {
            logger_1.default.error("Error parsing Arxiv XML", { error: error.message });
            return [];
        }
    }
    /**
     * Deduplicate papers based on title similarity
     */
    static deduplicatePapers(papers) {
        const seen = new Set();
        const unique = [];
        for (const paper of papers) {
            const key = paper.doi || paper.title.toLowerCase().replace(/\s+/g, "");
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(paper);
            }
        }
        return unique;
    }
    /**
     * Rank papers by relevance
     */
    static rankPapers(papers, keywords) {
        return papers
            .map((paper) => ({
            ...paper,
            relevanceScore: this.calculateRelevance(paper, keywords),
            citation: "",
            source: paper.source || "crossref",
        }))
            .sort((a, b) => {
            // Sort by relevance, then citation count, then year
            if (Math.abs(a.relevanceScore - b.relevanceScore) > 5) {
                return b.relevanceScore - a.relevanceScore;
            }
            if (Math.abs((a.citationCount || 0) - (b.citationCount || 0)) > 10) {
                return (b.citationCount || 0) - (a.citationCount || 0);
            }
            return b.year - a.year;
        });
    }
    /**
     * Calculate relevance score
     */
    static calculateRelevance(paper, keywords) {
        let score = 0;
        const title = paper.title.toLowerCase();
        const abstract = (paper.abstract || "").toLowerCase();
        // Title matches (high weight)
        keywords.forEach((keyword) => {
            if (title.includes(keyword.toLowerCase())) {
                score += 30;
            }
        });
        // Abstract matches (medium weight)
        keywords.forEach((keyword) => {
            if (abstract.includes(keyword.toLowerCase())) {
                score += 10;
            }
        });
        // Citation count bonus (capped at 20)
        score += Math.min(20, (paper.citationCount || 0) / 10);
        // Recency bonus
        const age = new Date().getFullYear() - paper.year;
        if (age === 0)
            score += 15;
        else if (age === 1)
            score += 10;
        else if (age === 2)
            score += 5;
        return Math.min(100, score);
    }
    /**
     * Format citation in APA style
     */
    static formatCitation(paper, style = "APA") {
        const authors = paper.authors.slice(0, 3).join(", ");
        const moreAuthors = paper.authors.length > 3 ? ", et al." : "";
        if (style === "APA") {
            return `${authors}${moreAuthors} (${paper.year}). ${paper.title}. ${paper.journal || ""}${paper.doi ? ` https://doi.org/${paper.doi}` : ""}`;
        }
        // Default format
        return `${authors}${moreAuthors}. "${paper.title}." ${paper.year}.`;
    }
}
exports.MissingLinkService = MissingLinkService;
