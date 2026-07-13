"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcademicDatabaseService = void 0;
const logger_1 = __importDefault(require("../monitoring/logger"));
const axios_1 = __importDefault(require("axios"));
const string_similarity_1 = require("string-similarity");
const openAlexService_1 = require("./openAlexService");
class AcademicDatabaseService {
    // API keys will be retrieved via SecretsService
    static async searchAcademicDatabases(text) {
        logger_1.default.info("Starting parallel academic database search");
        const TIMEOUT_MS = 10000; // 10s timeout per API
        const withTimeout = (promise, name) => {
            return Promise.race([
                promise,
                new Promise((_, reject) => setTimeout(() => reject(new Error(`${name} timeout`)), TIMEOUT_MS))
            ]);
        };
        const searchPromises = [
            withTimeout(this.searchCrossRef(text, null), "CrossRef").catch(e => (logger_1.default.warn("CrossRef check failed", { e }), [])),
            withTimeout(this.searchArXiv(text), "ArXiv").catch(e => (logger_1.default.warn("ArXiv check failed", { e }), [])),
            withTimeout(this.searchPubMed(text, null), "PubMed").catch(e => (logger_1.default.warn("PubMed check failed", { e }), [])),
            withTimeout(this.searchOpenAlex(text), "OpenAlex").catch(e => (logger_1.default.warn("OpenAlex check failed", { e }), []))
        ];
        const resultsArrays = await Promise.all(searchPromises);
        const results = resultsArrays.flat();
        // Sort by similarity descending
        return results.sort((a, b) => b.similarity - a.similarity);
    }
    /**
     * Specific search by DOI for pinpoint accuracy
     */
    static async searchByDOI(doi) {
        try {
            const response = await axios_1.default.get(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
                headers: { "User-Agent": "ColabWize/1.0 (mailto:hello@colabwize.com)" },
                timeout: 5000,
            });
            if (response.data && response.data.message) {
                const item = response.data.message;
                const year = item.published?.["date-parts"]?.[0]?.[0] || item.created?.["date-parts"]?.[0]?.[0];
                const abstract = item.abstract || "";
                // If CrossRef has no abstract, try OpenAlex for enrichment
                if (!abstract) {
                    try {
                        const oaResults = await openAlexService_1.OpenAlexService.searchPapers(doi, 1);
                        if (oaResults.length > 0 && oaResults[0].abstract) {
                            return {
                                title: oaResults[0].title,
                                authors: oaResults[0].authors,
                                abstract: oaResults[0].abstract,
                                url: oaResults[0].url,
                                year: oaResults[0].year,
                                database: "openalex",
                                isRetracted: item["is-retracted"] // Keep CrossRef retraction status as it's authoritative
                            };
                        }
                    }
                    catch (ignore) { }
                }
                return {
                    title: Array.isArray(item.title) ? item.title[0] : item.title,
                    authors: item.author?.map((auth) => `${auth.family || ""} ${auth.given || ""}`.trim()) || [],
                    abstract: abstract,
                    url: `https://doi.org/${item.DOI}`,
                    year: year,
                    database: "crossref",
                    isRetracted: item["is-retracted"] === true || item["update-to"]?.some((u) => u.type === "retraction")
                };
            }
        }
        catch (error) {
            logger_1.default.warn("DOI search failed", { doi, error: error.message });
            // Fallback to OpenAlex if CrossRef completely failed
            try {
                const oaResults = await openAlexService_1.OpenAlexService.searchPapers(doi, 1);
                if (oaResults.length > 0) {
                    return {
                        title: oaResults[0].title,
                        authors: oaResults[0].authors,
                        abstract: oaResults[0].abstract || "",
                        url: oaResults[0].url,
                        year: oaResults[0].year,
                        database: "openalex",
                        isRetracted: false // Unknown
                    };
                }
            }
            catch (e) {
                // Ignore
            }
        }
        return null;
    }
    static async searchOpenAlex(text) {
        try {
            // Use existing OpenAlexService
            const results = await openAlexService_1.OpenAlexService.searchPapers(text, 3);
            return results.map(paper => {
                const titleScore = this.calculateTextSimilarity(text, paper.title);
                const fullScore = this.calculateTextSimilarity(text, `${paper.title} ${paper.abstract || ""}`);
                return {
                    title: paper.title,
                    authors: paper.authors,
                    abstract: paper.abstract || "",
                    url: paper.url || "",
                    year: paper.year,
                    similarity: Math.max(titleScore, fullScore),
                    database: "openalex"
                };
            }).filter(item => item.similarity > 0.3);
        }
        catch (error) {
            logger_1.default.warn("OpenAlex search adapter failed", { error: error.message });
            return [];
        }
    }
    static async searchCrossRef(text, apiKey) {
        // Extract key phrases from text for better search
        const query = text.substring(0, 200); // Limit query length
        try {
            const response = await axios_1.default.get("https://api.crossref.org/works", {
                params: {
                    query: query,
                    rows: 5,
                    select: "title,author,abstract,DOI,published,created",
                },
                headers: apiKey
                    ? { "Crossref-Plus-API-Token": `Bearer ${apiKey}` }
                    : { "User-Agent": "ColabWize/1.0 (mailto:hello@colabwize.com)" }, // Polite pool
                timeout: 10000,
            });
            if (response.data &&
                response.data.message &&
                response.data.message.items) {
                return response.data.message.items
                    .map((item) => {
                    const extractedTitle = Array.isArray(item.title) ? item.title[0] || "" : item.title || "";
                    const itemText = `${extractedTitle} ${item.abstract || ""}`;
                    // Extract publication year from CrossRef date-parts
                    // Format: item.published["date-parts"][[year, month, day]]
                    const year = item.published?.["date-parts"]?.[0]?.[0] ||
                        item.created?.["date-parts"]?.[0]?.[0];
                    // Calculate score against Title (highest precision) and Title+Abstract (fallback)
                    const titleScore = this.calculateTextSimilarity(text, extractedTitle);
                    const fullScore = this.calculateTextSimilarity(text, itemText);
                    let bestScore = Math.max(titleScore, fullScore);
                    // Apply year penalty if years don't match
                    const citationYear = this.extractYear(text);
                    if (citationYear && year) {
                        const yearDiff = Math.abs(citationYear - year);
                        if (yearDiff > 1) {
                            bestScore *= 0.5; // 50% penalty for year mismatch
                        }
                    }
                    return {
                        title: extractedTitle,
                        authors: Array.isArray(item.author)
                            ? item.author.map((auth) => `${auth.family || ""} ${auth.given || ""}`.trim())
                            : [],
                        abstract: item.abstract || "",
                        url: `https://doi.org/${item.DOI}`,
                        year: year,
                        similarity: bestScore,
                        database: "crossref",
                        isRetracted: item["is-retracted"] === true || item["update-to"]?.some((u) => u.type === "retraction")
                    };
                })
                    .filter((item) => item.similarity > 0.3); // Only return items with significant similarity
            }
        }
        catch (error) {
            logger_1.default.warn("CrossRef API error", { error: error.message });
        }
        return [];
    }
    static async searchSemanticScholar(text, apiKey) {
        const query = encodeURIComponent(text.substring(0, 200));
        try {
            const response = await axios_1.default.get(`https://api.semanticscholar.org/graph/v1/paper/search`, {
                params: {
                    query: query,
                    limit: 5,
                },
                headers: apiKey ? { "x-api-key": apiKey } : {},
                timeout: 10000,
            });
            if (response.data && response.data.data) {
                return response.data.data
                    .map((paper) => {
                    const title = paper.title || "";
                    const abstract = paper.abstract || "";
                    const year = paper.year; // Semantic Scholar provides year directly
                    const titleScore = this.calculateTextSimilarity(text, title);
                    const fullScore = this.calculateTextSimilarity(text, `${title} ${abstract}`);
                    let bestScore = Math.max(titleScore, fullScore);
                    // Apply year penalty if years don't match
                    const citationYear = this.extractYear(text);
                    if (citationYear && year) {
                        const yearDiff = Math.abs(citationYear - year);
                        if (yearDiff > 1) {
                            bestScore *= 0.5;
                        }
                    }
                    return {
                        title: title,
                        authors: paper.authors
                            ? paper.authors.map((auth) => auth.name)
                            : [],
                        abstract: abstract,
                        url: paper.url || "",
                        year: year,
                        similarity: bestScore,
                        database: "semantic_scholar",
                    };
                })
                    .filter((item) => item.similarity > 0.3);
            }
        }
        catch (error) {
            logger_1.default.warn("Semantic Scholar API error", {
                error: error.message,
            });
        }
        return [];
    }
    static async searchArXiv(text) {
        // arXiv API doesn't require API key
        const query = encodeURIComponent(text.substring(0, 200));
        try {
            const response = await axios_1.default.get(`http://export.arxiv.org/api/query`, {
                params: {
                    search_query: `ti:${query} OR abs:${query}`,
                    max_results: 5,
                },
                timeout: 10000,
            });
            // Simple XML parsing for arXiv response
            const xmlText = response.data;
            const entries = xmlText.match(/<entry>[\s\S]*?<\/entry>/g) || [];
            return entries
                .map((entry) => {
                const title = entry.match(/<title>[\s\S]*?<\/title>/)?.[1]?.trim() || "";
                const summary = entry.match(/<summary>[\s\S]*?<\/summary>/)?.[1]?.trim() || "";
                const id = entry.match(/<id>[\s\S]*?<\/id>/)?.[1]?.trim() || "";
                // Extract year from arXiv ID (format: http://arxiv.org/abs/2107.12345 -> 2021)
                let year;
                const arxivIdMatch = id.match(/\/(\d{2})(\d{2})\./); // 2107 -> year 21, month 07
                if (arxivIdMatch) {
                    const yearPrefix = parseInt(arxivIdMatch[1]);
                    year = yearPrefix >= 90 ? 1900 + yearPrefix : 2000 + yearPrefix;
                }
                const titleScore = this.calculateTextSimilarity(text, title);
                const fullScore = this.calculateTextSimilarity(text, `${title} ${summary}`);
                let bestScore = Math.max(titleScore, fullScore);
                // Apply year penalty if years don't match
                const citationYear = this.extractYear(text);
                if (citationYear && year) {
                    const yearDiff = Math.abs(citationYear - year);
                    if (yearDiff > 1) {
                        bestScore *= 0.5;
                    }
                }
                // Extract authors
                const authorMatches = entry.matchAll(/<name>(.*?)<\/name>/g);
                const authors = Array.from(authorMatches, (match) => match[1]);
                return {
                    title,
                    authors,
                    abstract: summary,
                    url: id,
                    year: year,
                    similarity: bestScore,
                    database: "arxiv",
                };
            })
                .filter((item) => item.similarity > 0.3);
        }
        catch (error) {
            logger_1.default.warn("arXiv API error", { error: error.message });
        }
        return [];
    }
    static async searchIEEE(text, apiKey) {
        if (!apiKey) {
            logger_1.default.warn("IEEE Xplore API key not configured");
            return [];
        }
        const query = encodeURIComponent(text.substring(0, 200));
        try {
            const response = await axios_1.default.post("https://ieeexploreapi.ieee.org/api/v1/search/articles", {
                queryText: text.substring(0, 200),
                apiKey: apiKey,
                maxRecords: 5,
                startIndex: 0,
            }, {
                headers: {
                    "Content-Type": "application/json",
                },
                timeout: 10000,
            });
            if (response.data && response.data.data) {
                return response.data.data
                    .map((article) => {
                    const title = article.title || "";
                    const abstract = article.abstract || "";
                    const titleScore = this.calculateTextSimilarity(text, title);
                    const fullScore = this.calculateTextSimilarity(text, `${title} ${abstract}`);
                    return {
                        title: title,
                        authors: article.authors
                            ? article.authors.map((auth) => auth.full_name || "")
                            : [],
                        abstract: abstract,
                        url: article.html_url || "",
                        similarity: Math.max(titleScore, fullScore),
                        database: "ieee",
                    };
                })
                    .filter((item) => item.similarity > 0.3);
            }
        }
        catch (error) {
            logger_1.default.warn("IEEE Xplore API error", { error: error.message });
        }
        return [];
    }
    static async searchPubMed(text, apiKey) {
        const query = encodeURIComponent(text.substring(0, 200));
        try {
            // First, search for PubMed IDs
            const searchResponse = await axios_1.default.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi", {
                params: {
                    db: "pubmed",
                    term: query,
                    retmax: 5,
                    retmode: "json",
                    api_key: apiKey || undefined,
                },
                timeout: 10000,
            });
            if (searchResponse.data &&
                searchResponse.data.esearchresult &&
                searchResponse.data.esearchresult.idlist) {
                const ids = searchResponse.data.esearchresult.idlist;
                if (ids.length > 0) {
                    // Fetch details for the found IDs
                    const fetchResponse = await axios_1.default.get("https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi", {
                        params: {
                            db: "pubmed",
                            id: ids.join(","),
                            retmode: "xml",
                            api_key: apiKey || undefined,
                        },
                        timeout: 10000,
                    });
                    // Simple XML parsing for PubMed response
                    const xmlText = fetchResponse.data;
                    const entries = xmlText.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];
                    return entries
                        .map((entry) => {
                        const title = entry
                            .match(/<ArticleTitle>[\s\S]*?<\/ArticleTitle>/)?.[1]
                            ?.trim() || "";
                        const abstract = entry
                            .match(/<AbstractText>[\s\S]*?<\/AbstractText>/)?.[1]
                            ?.trim() || "";
                        const pmid = entry.match(/<PMID>[\s\S]*?<\/PMID>/)?.[1]?.trim() || "";
                        // Extract year from PubMed XML
                        const yearMatch = entry.match(/<PubDate>[\s\S]*?<Year>(\d{4})<\/Year>/);
                        const year = yearMatch ? parseInt(yearMatch[1]) : undefined;
                        const titleScore = this.calculateTextSimilarity(text, title);
                        const fullScore = this.calculateTextSimilarity(text, `${title} ${abstract}`);
                        let bestScore = Math.max(titleScore, fullScore);
                        // Apply year penalty if years don't match
                        const citationYear = this.extractYear(text);
                        if (citationYear && year) {
                            const yearDiff = Math.abs(citationYear - year);
                            if (yearDiff > 1) {
                                bestScore *= 0.5;
                            }
                        }
                        // Extract authors
                        const authorMatches = entry.matchAll(/<LastName>([\s\S]*?)<\/LastName>[\s\S]*?<ForeName>([\s\S]*?)<\/ForeName>/g);
                        const authors = Array.from(authorMatches, (match) => `${match[2]} ${match[1]}`);
                        return {
                            title,
                            authors,
                            abstract,
                            url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
                            year: year,
                            similarity: bestScore,
                            database: "pubmed",
                        };
                    })
                        .filter((item) => item.similarity > 0.3);
                }
            }
        }
        catch (error) {
            logger_1.default.warn("PubMed API error", { error: error.message });
        }
        return [];
    }
    /**
     * Extract publication year from citation text
     */
    static extractYear(text) {
        // Match 4-digit years starting with 19 or 20 (1900-2099)
        const yearMatch = text.match(/\b(19|20)\d{2}\b/);
        return yearMatch ? parseInt(yearMatch[0]) : null;
    }
    static calculateTextSimilarity(text1, text2) {
        if (!text1 || !text2)
            return 0;
        // Normalize and clean the texts
        const cleanText1 = text1
            .toLowerCase()
            .replace(/[^\w\s]/gi, " ")
            .trim();
        const cleanText2 = text2
            .toLowerCase()
            .replace(/[^\w\s]/gi, " ")
            .trim();
        if (cleanText1.length < 10 || cleanText2.length < 10) {
            return 0;
        }
        // Use string similarity for quick comparison
        return (0, string_similarity_1.compareTwoStrings)(cleanText1, cleanText2);
    }
}
exports.AcademicDatabaseService = AcademicDatabaseService;
