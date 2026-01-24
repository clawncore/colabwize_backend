import { SecretsService } from "./secrets-service";
import logger from "../monitoring/logger";
import axios from "axios";
import { compareTwoStrings } from "string-similarity";

export class AcademicDatabaseService {
    // API keys will be retrieved via SecretsService

    /**
     * Search academic databases for similar content
     */
    static async searchAcademicDatabases(text: string): Promise<
        Array<{
            title: string;
            authors: string[];
            abstract: string;
            url: string;
            year?: number;
            similarity: number;
            database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
        }>
    > {
        // Using FREE public APIs only (no API keys needed)
        const results: Array<{
            title: string;
            authors: string[];
            abstract: string;
            url: string;
            similarity: number;
            database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
        }> = [];

        logger.info("Starting academic database search (free public APIs only)");

        // Search CrossRef (free polite pool - no key needed)
        try {
            const crossrefResults = await this.searchCrossRef(text, null);
            results.push(...crossrefResults);
        } catch (error) {
            logger.warn("CrossRef search failed", {
                error: (error as Error).message,
            });
        }

        // Search arXiv (completely free - no key needed)
        try {
            const arxivResults = await this.searchArXiv(text);
            results.push(...arxivResults);
        } catch (error) {
            logger.warn("arXiv search failed", { error: (error as Error).message });
        }

        // Search PubMed (public API - no key needed)
        try {
            const pubmedResults = await this.searchPubMed(text, null);
            results.push(...pubmedResults);
        } catch (error) {
            logger.warn("PubMed search failed", { error: (error as Error).message });
        }

        // Semantic Scholar & IEEE skipped (require API keys)

        return results;
    }

    private static async searchCrossRef(
        text: string,
        apiKey: string | null
    ): Promise<
        Array<{
            title: string;
            authors: string[];
            abstract: string;
            url: string;
            similarity: number;
            database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
        }>
    > {
        // Extract key phrases from text for better search
        const query = text.substring(0, 200); // Limit query length

        try {
            const response = await axios.get("https://api.crossref.org/works", {
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

            if (
                response.data &&
                response.data.message &&
                response.data.message.items
            ) {
                return response.data.message.items
                    .map((item: any) => {
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
                                ? item.author.map((auth: any) =>
                                    `${auth.family || ""} ${auth.given || ""}`.trim()
                                )
                                : [],
                            abstract: item.abstract || "",
                            url: `https://doi.org/${item.DOI}`,
                            year: year,
                            similarity: bestScore,
                            database: "crossref" as const,
                        };
                    })
                    .filter((item: any) => item.similarity > 0.3); // Only return items with significant similarity
            }
        } catch (error) {
            logger.warn("CrossRef API error", { error: (error as Error).message });
        }

        return [];
    }

    private static async searchSemanticScholar(
        text: string,
        apiKey: string
    ): Promise<
        Array<{
            title: string;
            authors: string[];
            abstract: string;
            url: string;
            similarity: number;
            database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
        }>
    > {
        const query = encodeURIComponent(text.substring(0, 200));

        try {
            const response = await axios.get(
                `https://api.semanticscholar.org/graph/v1/paper/search`,
                {
                    params: {
                        query: query,
                        limit: 5,
                    },
                    headers: apiKey ? { "x-api-key": apiKey } : {},
                    timeout: 10000,
                }
            );

            if (response.data && response.data.data) {
                return response.data.data
                    .map((paper: any) => {
                        const title = paper.title || "";
                        const abstract = paper.abstract || "";
                        const year = paper.year;  // Semantic Scholar provides year directly

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
                                ? paper.authors.map((auth: any) => auth.name)
                                : [],
                            abstract: abstract,
                            url: paper.url || "",
                            year: year,
                            similarity: bestScore,
                            database: "semantic_scholar" as const,
                        };
                    })
                    .filter((item: any) => item.similarity > 0.3);
            }
        } catch (error) {
            logger.warn("Semantic Scholar API error", {
                error: (error as Error).message,
            });
        }

        return [];
    }

    private static async searchArXiv(text: string): Promise<
        Array<{
            title: string;
            authors: string[];
            abstract: string;
            url: string;
            similarity: number;
            database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
        }>
    > {
        // arXiv API doesn't require API key
        const query = encodeURIComponent(text.substring(0, 200));

        try {
            const response = await axios.get(`http://export.arxiv.org/api/query`, {
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
                .map((entry: string) => {
                    const title =
                        entry.match(/<title>[\s\S]*?<\/title>/)?.[1]?.trim() || "";
                    const summary =
                        entry.match(/<summary>[\s\S]*?<\/summary>/)?.[1]?.trim() || "";
                    const id = entry.match(/<id>[\s\S]*?<\/id>/)?.[1]?.trim() || "";

                    // Extract year from arXiv ID (format: http://arxiv.org/abs/2107.12345 -> 2021)
                    let year: number | undefined;
                    const arxivIdMatch = id.match(/\/(\d{2})(\d{2})\./);  // 2107 -> year 21, month 07
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
                    const authorMatches = entry.matchAll(
                        /<name>(.*?)<\/name>/g
                    ) as IterableIterator<RegExpMatchArray>;
                    const authors = Array.from(authorMatches, (match) => match[1]);

                    return {
                        title,
                        authors,
                        abstract: summary,
                        url: id,
                        year: year,
                        similarity: bestScore,
                        database: "arxiv" as const,
                    };
                })
                .filter((item: any) => item.similarity > 0.3);
        } catch (error) {
            logger.warn("arXiv API error", { error: (error as Error).message });
        }

        return [];
    }

    private static async searchIEEE(
        text: string,
        apiKey: string | null
    ): Promise<
        Array<{
            title: string;
            authors: string[];
            abstract: string;
            url: string;
            similarity: number;
            database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
        }>
    > {
        if (!apiKey) {
            logger.warn("IEEE Xplore API key not configured");
            return [];
        }

        const query = encodeURIComponent(text.substring(0, 200));

        try {
            const response = await axios.post(
                "https://ieeexploreapi.ieee.org/api/v1/search/articles",
                {
                    queryText: text.substring(0, 200),
                    apiKey: apiKey,
                    maxRecords: 5,
                    startIndex: 0,
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                    },
                    timeout: 10000,
                }
            );

            if (response.data && response.data.data) {
                return response.data.data
                    .map((article: any) => {
                        const title = article.title || "";
                        const abstract = article.abstract || "";
                        const titleScore = this.calculateTextSimilarity(text, title);
                        const fullScore = this.calculateTextSimilarity(text, `${title} ${abstract}`);

                        return {
                            title: title,
                            authors: article.authors
                                ? article.authors.map((auth: any) => auth.full_name || "")
                                : [],
                            abstract: abstract,
                            url: article.html_url || "",
                            similarity: Math.max(titleScore, fullScore),
                            database: "ieee" as const,
                        };
                    })
                    .filter((item: any) => item.similarity > 0.3);
            }
        } catch (error) {
            logger.warn("IEEE Xplore API error", { error: (error as Error).message });
        }

        return [];
    }

    private static async searchPubMed(
        text: string,
        apiKey: string | null
    ): Promise<
        Array<{
            title: string;
            authors: string[];
            abstract: string;
            url: string;
            similarity: number;
            database: "crossref" | "semantic_scholar" | "arxiv" | "ieee" | "pubmed";
        }>
    > {
        const query = encodeURIComponent(text.substring(0, 200));

        try {
            // First, search for PubMed IDs
            const searchResponse = await axios.get(
                "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
                {
                    params: {
                        db: "pubmed",
                        term: query,
                        retmax: 5,
                        retmode: "json",
                        api_key: apiKey || undefined,
                    },
                    timeout: 10000,
                }
            );

            if (
                searchResponse.data &&
                searchResponse.data.esearchresult &&
                searchResponse.data.esearchresult.idlist
            ) {
                const ids = searchResponse.data.esearchresult.idlist;

                if (ids.length > 0) {
                    // Fetch details for the found IDs
                    const fetchResponse = await axios.get(
                        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
                        {
                            params: {
                                db: "pubmed",
                                id: ids.join(","),
                                retmode: "xml",
                                api_key: apiKey || undefined,
                            },
                            timeout: 10000,
                        }
                    );

                    // Simple XML parsing for PubMed response
                    const xmlText = fetchResponse.data;
                    const entries =
                        xmlText.match(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g) || [];

                    return entries
                        .map((entry: string) => {
                            const title =
                                entry
                                    .match(/<ArticleTitle>[\s\S]*?<\/ArticleTitle>/)?.[1]
                                    ?.trim() || "";
                            const abstract =
                                entry
                                    .match(/<AbstractText>[\s\S]*?<\/AbstractText>/)?.[1]
                                    ?.trim() || "";
                            const pmid =
                                entry.match(/<PMID>[\s\S]*?<\/PMID>/)?.[1]?.trim() || "";

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
                            const authorMatches = entry.matchAll(
                                /<LastName>([\s\S]*?)<\/LastName>[\s\S]*?<ForeName>([\s\S]*?)<\/ForeName>/g
                            ) as IterableIterator<RegExpMatchArray>;
                            const authors = Array.from(
                                authorMatches,
                                (match) => `${match[2]} ${match[1]}`
                            );

                            return {
                                title,
                                authors,
                                abstract,
                                url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
                                year: year,
                                similarity: bestScore,
                                database: "pubmed" as const,
                            };
                        })
                        .filter((item: any) => item.similarity > 0.3);
                }
            }
        } catch (error) {
            logger.warn("PubMed API error", { error: (error as Error).message });
        }

        return [];
    }

    /**
     * Extract publication year from citation text
     */
    public static extractYear(text: string): number | null {
        // Match 4-digit years starting with 19 or 20 (1900-2099)
        const yearMatch = text.match(/\b(19|20)\d{2}\b/);
        return yearMatch ? parseInt(yearMatch[0]) : null;
    }

    public static calculateTextSimilarity(text1: string, text2: string): number {
        if (!text1 || !text2) return 0;

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
        return compareTwoStrings(cleanText1, cleanText2);
    }
}
