"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MendeleyService = void 0;
const axios_1 = __importDefault(require("axios"));
const prisma_js_1 = require("../lib/prisma.js");
const cslNormalization_js_1 = require("../utils/cslNormalization.js");
const MENDELEY_CLIENT_ID = (process.env.MENDELEY_CLIENT_ID || "").trim();
const MENDELEY_CLIENT_SECRET = (process.env.MENDELEY_CLIENT_SECRET || "").trim();
const MENDELEY_API_KEY = (process.env.MENDELEY_API_KEY || "").trim();
if (!MENDELEY_API_KEY && process.env.NODE_ENV === "production") {
    console.warn("[Mendeley Service] WARNING: MENDELEY_API_KEY is not set. Mendeley API requests will fail.");
}
const TOKEN_URL = "https://api.mendeley.com/oauth/token";
/**
 * Map Mendeley document types to CSL item types.
 */
function mapMendeleyType(mendeleyType) {
    const typeMap = {
        journal_article: "article-journal",
        book: "book",
        book_section: "chapter",
        conference_proceedings: "paper-conference",
        report: "report",
        thesis: "thesis",
        web_page: "webpage",
    };
    return typeMap[mendeleyType] || "article-journal";
}
class MendeleyService {
    /**
     * Get a valid access token for the user.
     * If the current token is expired, it attempts to refresh it.
     */
    static async getValidToken(userId) {
        const user = await prisma_js_1.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                mendeley_access_token: true,
                mendeley_refresh_token: true,
                mendeley_token_expires_at: true,
            }
        });
        if (!user || !user.mendeley_access_token) {
            throw new Error("Mendeley account not linked");
        }
        const now = new Date();
        const expiresAt = user.mendeley_token_expires_at ? new Date(user.mendeley_token_expires_at) : null;
        // If token is expired (or expires in less than 30 seconds), refresh it
        if (user.mendeley_refresh_token && expiresAt && now.getTime() > (expiresAt.getTime() - 30000)) {
            console.log(`[Mendeley Service] Token expired for user ${userId}, refreshing...`);
            return await this.refreshToken(userId, user.mendeley_refresh_token);
        }
        return user.mendeley_access_token;
    }
    /**
     * Refresh the Mendeley access token using the refresh token
     */
    static async refreshToken(userId, refreshToken) {
        try {
            console.log(`[Mendeley Service] Requesting new token from Elsevier for user: ${userId}`);
            const params = new URLSearchParams();
            params.append("grant_type", "refresh_token");
            params.append("refresh_token", refreshToken);
            params.append("client_id", MENDELEY_CLIENT_ID);
            params.append("client_secret", MENDELEY_CLIENT_SECRET);
            const headers = {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            };
            // Only add Elsevier API Key if it's explicitly provided and not just fallback to secret
            if (MENDELEY_API_KEY) {
                headers["X-ELS-APIKey"] = MENDELEY_API_KEY;
            }
            const response = await axios_1.default.post(TOKEN_URL, params.toString(), {
                headers,
                timeout: 10000 // 10s timeout for token exchange
            });
            const { access_token, refresh_token, expires_in } = response.data;
            if (!access_token) {
                throw new Error("Elsevier refresh call returned no access_token");
            }
            const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000);
            await prisma_js_1.prisma.user.update({
                where: { id: userId },
                data: {
                    mendeley_access_token: access_token,
                    mendeley_refresh_token: refresh_token || refreshToken, // reuse if not rotated
                    mendeley_token_expires_at: expiresAt,
                }
            });
            console.log(`[Mendeley Service] Token successfully refreshed for user: ${userId}`);
            return access_token;
        }
        catch (error) {
            console.error("[Mendeley Service] Refresh failed:", error.response?.data || error.message);
            // If refresh fails, we might need to clear the tokens so the user re-authenticates
            if (error.response?.status === 400 || error.response?.status === 401) {
                console.warn(`[Mendeley Service] Refresh token invalid for user ${userId}. Clearing tokens.`);
                await prisma_js_1.prisma.user.update({
                    where: { id: userId },
                    data: {
                        mendeley_access_token: null,
                        mendeley_refresh_token: null,
                        mendeley_token_expires_at: null,
                    }
                });
            }
            throw new Error(`Mendeley session expired. Please reconnect your account. (${error.message})`);
        }
    }
    static async fetchLibrary(userId, limit = 50, start = 0) {
        try {
            const accessToken = await this.getValidToken(userId);
            const headers = {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json", // Use standard JSON
            };
            if (MENDELEY_API_KEY) {
                headers["X-ELS-APIKey"] = MENDELEY_API_KEY;
            }
            const response = await axios_1.default.get("https://api.mendeley.com/documents", {
                headers,
                params: {
                    limit,
                    view: "all"
                },
                timeout: 15000 // 15s timeout
            });
            return response.data || [];
        }
        catch (error) {
            console.error("[Mendeley Service] fetchLibrary Error:", error.response?.data || error.message);
            throw error;
        }
    }
    static async queryItems(userId, query) {
        try {
            const accessToken = await this.getValidToken(userId);
            const headers = {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json"
            };
            if (MENDELEY_API_KEY) {
                headers["X-ELS-APIKey"] = MENDELEY_API_KEY;
            }
            const response = await axios_1.default.get("https://api.mendeley.com/search/catalog", {
                headers,
                params: {
                    title: query,
                    limit: 50,
                    view: "all"
                },
                timeout: 15000
            });
            return response.data || [];
        }
        catch (error) {
            console.error("[Mendeley Service] queryItems Error:", error.response?.data || error.message);
            throw error;
        }
    }
    /**
     * Import a Mendeley item into the project's citation list.
     * Normalizes the Mendeley data through the CSL normalization pipeline
     * before creating the citation record, matching Zotero import behavior.
     */
    static async importItem(colabUserId, projectId, itemData) {
        try {
            // Build a normalized input object from Mendeley data
            const normalizedInput = {
                ...itemData,
                id: itemData.id,
                title: itemData.title,
                authors: itemData.authors?.map((a) => ({
                    given: a.first_name,
                    family: a.last_name,
                })) || [],
                year: itemData.year,
                type: mapMendeleyType(itemData.type),
                DOI: itemData.identifiers?.doi,
                URL: itemData.websites?.[0],
                journal: itemData.source,
                publisher: itemData.publisher,
                volume: itemData.volume,
                issue: itemData.issue,
            };
            // Run through the CSL normalization pipeline
            const csl = (0, cslNormalization_js_1.normalizeToCSL)(normalizedInput);
            // Extract structured fields from the normalized CSL object
            const authors = csl.author?.map((a) => {
                if (a.family && a.given)
                    return `${a.family}, ${a.given}`;
                return a.family || a.given || a.literal || "Unknown";
            }).join("; ") || "Unknown Author";
            const year = csl.issued?.["date-parts"]?.[0]?.[0] || parseInt(csl.year) || 0;
            // Extract identifiers
            const identifiers = {};
            if (csl.DOI || csl.doi)
                identifiers.doi = csl.DOI || csl.doi;
            if (csl.ISBN || csl.isbn)
                identifiers.isbn = csl.ISBN || csl.isbn;
            if (csl.ISSN || csl.issn)
                identifiers.issn = csl.ISSN || csl.issn;
            const citation = await prisma_js_1.prisma.citation.create({
                data: {
                    user_id: colabUserId,
                    project_id: projectId,
                    title: csl.title || "Untitled",
                    author: authors,
                    authors: csl.author ?? undefined,
                    year: Number(year),
                    type: csl.type || "article-journal",
                    doi: csl.DOI || csl.doi,
                    url: csl.URL || csl.url,
                    journal: csl["container-title"],
                    publisher: csl.publisher,
                    abstract: csl.abstract,
                    volume: csl.volume,
                    issue: csl.issue,
                    pages: csl.pages,
                    source: "Mendeley",
                    vault_verified: true,
                    provider: "mendeley",
                    providerId: itemData.id,
                    rawMetadata: itemData,
                    formatted_citations: itemData,
                }
            });
            return citation;
        }
        catch (error) {
            console.error("[Mendeley Service] Import Error:", error.message);
            throw new Error(`Failed to import Mendeley item: ${error.message}`);
        }
    }
    /**
     * Fetch user's Mendeley folders
     */
    static async fetchFolders(userId) {
        try {
            const accessToken = await this.getValidToken(userId);
            const headers = {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json"
            };
            if (MENDELEY_API_KEY) {
                headers["X-ELS-APIKey"] = MENDELEY_API_KEY;
            }
            const response = await axios_1.default.get("https://api.mendeley.com/folders", {
                headers,
                timeout: 15000
            });
            return response.data || [];
        }
        catch (error) {
            console.error("[Mendeley Service] fetchFolders Error:", error.response?.data || error.message);
            throw error;
        }
    }
    /**
     * Fetch items from a specific Mendeley folder
     */
    static async fetchFolderItems(userId, folderId) {
        try {
            const accessToken = await this.getValidToken(userId);
            const headers = {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json"
            };
            if (MENDELEY_API_KEY) {
                headers["X-ELS-APIKey"] = MENDELEY_API_KEY;
            }
            const response = await axios_1.default.get(`https://api.mendeley.com/folders/${folderId}/documents`, {
                headers,
                timeout: 15000
            });
            return response.data || [];
        }
        catch (error) {
            console.error("[Mendeley Service] fetchFolderItems Error:", error.response?.data || error.message);
            throw error;
        }
    }
    /**
     * Create a new document in Mendeley
     */
    static async createDocument(userId, documentData) {
        try {
            const accessToken = await this.getValidToken(userId);
            const headers = {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                Accept: "application/json"
            };
            if (MENDELEY_API_KEY) {
                headers["X-ELS-APIKey"] = MENDELEY_API_KEY;
            }
            const response = await axios_1.default.post("https://api.mendeley.com/documents", documentData, {
                headers,
                timeout: 15000
            });
            return response.data;
        }
        catch (error) {
            console.error("[Mendeley Service] createDocument Error:", error.response?.data || error.message);
            throw error;
        }
    }
}
exports.MendeleyService = MendeleyService;
