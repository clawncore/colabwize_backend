"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SearchService = void 0;
const logger_1 = __importDefault(require("../monitoring/logger"));
const prisma_1 = require("../lib/prisma");
const secrets_service_1 = __importDefault(require("./secrets-service"));
const BillingGateway_1 = require("../billing/BillingGateway");
class SearchService {
    // Track search usage for users
    static async trackSearchUsage(userId, searchType) {
        try {
            // Get current usage for the user this month
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const usage = await prisma_1.prisma.aIUsage.findUnique({
                where: {
                    user_id_month_year: {
                        user_id: userId,
                        month: now.getMonth() + 1,
                        year: now.getFullYear(),
                    },
                },
            });
            // Prepare update data based on search type
            const updateData = { updated_at: new Date() };
            if (searchType === "web") {
                updateData.web_search_count = usage?.web_search_count
                    ? usage.web_search_count + 1
                    : 1;
            }
            else {
                updateData.deep_search_count = usage?.deep_search_count
                    ? usage.deep_search_count + 1
                    : 1;
            }
            if (usage) {
                // Update existing usage record
                await prisma_1.prisma.aIUsage.update({
                    where: { id: usage.id },
                    data: updateData,
                });
            }
            else {
                // Create new usage record with initial values
                const createData = {
                    user_id: userId,
                    month: now.getMonth() + 1,
                    year: now.getFullYear(),
                    request_count: 0,
                    chat_message_count: 0,
                    image_generation_count: 0,
                    web_search_count: 0,
                    deep_search_count: 0,
                };
                // Set the appropriate count to 1 for the current search type
                if (searchType === "web") {
                    createData.web_search_count = 1;
                }
                else {
                    createData.deep_search_count = 1;
                }
                await prisma_1.prisma.aIUsage.create({
                    data: createData,
                });
            }
            return true;
        }
        catch (error) {
            logger_1.default.error("Error tracking search usage:", error);
            return false;
        }
    }
    // Perform a web search using a search API
    static async webSearch(userId, query, maxResults = 10) {
        // Reserve quota through the single billing pipeline (hold → execute →
        // confirm). checkActionEligibility was a dry-run gate that did not
        // consume; the gateway does both atomically. Declared before the outer
        // try so both the success-confirm and failure-release paths can see it.
        let billingEventId = null;
        try {
            const hold = await BillingGateway_1.BillingGateway.hold(userId, "ai_web_search");
            billingEventId = hold.eventId;
        }
        catch (billingError) {
            throw new Error(billingError.message || "Web search limit reached");
        }
        try {
            // Track analytics usage (non-billing).
            await this.trackSearchUsage(userId, "web");
            // Use a real search API if available
            let searchResults = [];
            const serpApiKey = await secrets_service_1.default.getSerpApiKey();
            if (serpApiKey) {
                // Use SerpAPI for real web search
                const searchUrl = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${serpApiKey}&num=${maxResults}`;
                const response = await fetch(searchUrl);
                const data = await response.json();
                if (data.error) {
                    throw new Error(`SerpAPI error: ${data.error}`);
                }
                if (data.organic_results) {
                    searchResults = data.organic_results
                        .slice(0, maxResults)
                        .map((result, index) => ({
                        title: result.title || "No title",
                        url: result.link || "#",
                        snippet: result.snippet || "No snippet available",
                        relevance: Math.max(95 - index * 5, 50), // Decreasing relevance
                    }));
                }
            }
            else {
                const googleCseId = await secrets_service_1.default.getGoogleCseId();
                const googleApiKey = await secrets_service_1.default.getGoogleApiKey();
                if (googleCseId && googleApiKey) {
                    // Use Google Custom Search Engine as fallback
                    const searchUrl = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${googleApiKey}&cx=${googleCseId}&num=${maxResults}`;
                    const response = await fetch(searchUrl);
                    const data = await response.json();
                    if (data.error) {
                        throw new Error(`Google CSE error: ${data.error.message}`);
                    }
                    if (data.items) {
                        searchResults = data.items.map((result, index) => ({
                            title: result.title || "No title",
                            url: result.link || "#",
                            snippet: result.snippet || "No snippet available",
                            relevance: Math.max(95 - index * 5, 50), // Decreasing relevance
                        }));
                    }
                }
                else {
                    // If no API keys are configured, throw an error rather than returning mock data
                    logger_1.default.warn("No search API keys configured. Search functionality requires API configuration.");
                    throw new Error("Search service not properly configured. Please contact administrator.");
                }
            }
            if (billingEventId) {
                await BillingGateway_1.BillingGateway.confirm(billingEventId);
            }
            return searchResults.slice(0, maxResults);
        }
        catch (error) {
            if (billingEventId) {
                await BillingGateway_1.BillingGateway.release(billingEventId, error.message);
            }
            logger_1.default.error("Error performing web search:", error);
            throw new Error(`Failed to perform web search: ${error.message}`);
        }
    }
    // Perform a Google Scholar search using SerpApi
    static async scholarSearch(userId, query, limit = 10, offset = 0) {
        let billingEventId = null;
        try {
            // Reserve quota through the single billing pipeline. Preserves the
            // soft-return-[] behavior on limit reached (existing UX).
            try {
                const hold = await BillingGateway_1.BillingGateway.hold(userId, "ai_web_search");
                billingEventId = hold.eventId;
            }
            catch {
                return [];
            }
            const serpApiKey = await secrets_service_1.default.getSerpApiKey();
            if (!serpApiKey) {
                if (billingEventId)
                    await BillingGateway_1.BillingGateway.release(billingEventId, "no api key");
                return [];
            }
            const searchUrl = `https://serpapi.com/search.json?engine=google_scholar&q=${encodeURIComponent(query)}&api_key=${serpApiKey}&num=${limit}&start=${offset}`;
            const response = await fetch(searchUrl);
            const data = await response.json();
            if (data.error || !data.organic_results) {
                if (billingEventId)
                    await BillingGateway_1.BillingGateway.release(billingEventId, "no results");
                return [];
            }
            if (billingEventId) {
                await BillingGateway_1.BillingGateway.confirm(billingEventId);
            }
            return data.organic_results.map((result) => ({
                externalId: result.result_id || `gs-${Math.random().toString(36).substr(2, 9)}`,
                title: result.title,
                abstract: result.snippet || "",
                authors: (result.publication_info?.authors || []).map((a) => ({
                    name: a.name || a,
                })),
                year: result.publication_info?.summary?.match(/\d{4}/)?.[0]
                    ? parseInt(result.publication_info.summary.match(/\d{4}/)[0])
                    : null,
                venue: "Google Scholar",
                citationCount: result.inline_links?.cited_by?.total || 0,
                url: result.link || null,
                openAccessPdf: result.resources?.[0]?.link || null,
                publicationTypes: ["Journal Article"],
                source: "Google Scholar",
            }));
        }
        catch (error) {
            if (billingEventId) {
                await BillingGateway_1.BillingGateway.release(billingEventId, error.message);
            }
            logger_1.default.error("Error performing scholar search:", error);
            return [];
        }
    }
    // Validate URL to prevent SSRF attacks
    static validateUrl(url) {
        try {
            const parsedUrl = new URL(url);
            // Disallow internal IP addresses (localhost, private networks)
            const hostname = parsedUrl.hostname.toLowerCase();
            // Check for internal IP addresses
            if (hostname === "localhost" ||
                hostname === "127.0.0.1" ||
                hostname.startsWith("10.") ||
                (hostname.startsWith("172.") &&
                    parseInt(hostname.split(".")[1]) >= 16 &&
                    parseInt(hostname.split(".")[1]) <= 31) ||
                hostname.startsWith("192.168.") ||
                hostname.startsWith("0.") ||
                hostname.startsWith("127.") ||
                hostname.startsWith("::1") ||
                hostname.startsWith("[::1]")) {
                throw new Error("Invalid URL: Access to internal addresses is blocked");
            }
            // Only allow HTTP and HTTPS protocols
            if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
                throw new Error("Invalid URL: Only HTTP and HTTPS protocols are allowed");
            }
        }
        catch (error) {
            if (error instanceof Error) {
                throw new Error(`Invalid URL: ${error.message}`);
            }
            else {
                throw new Error("Invalid URL: Invalid format");
            }
        }
    }
    // Get recent research topics for a user
    static async getRecentResearchTopics(userId, limit = 10) {
        try {
            const topics = await prisma_1.prisma.researchTopic.findMany({
                where: {
                    user_id: userId,
                },
                orderBy: {
                    created_at: "desc",
                },
                take: limit,
                select: {
                    id: true,
                    title: true,
                    description: true,
                    sources: true,
                    created_at: true,
                    updated_at: true,
                },
            });
            return topics;
        }
        catch (error) {
            logger_1.default.error("Error fetching recent research topics:", error);
            throw new Error("Failed to fetch recent research topics");
        }
    }
    // Save a research topic
    static async saveResearchTopic(userId, title, description, sources, sourcesData) {
        try {
            const topic = await prisma_1.prisma.researchTopic.create({
                data: {
                    user_id: userId,
                    title,
                    description,
                    sources,
                    sources_data: sourcesData,
                },
            });
            return topic;
        }
        catch (error) {
            logger_1.default.error("Error saving research topic:", error);
            throw new Error("Failed to save research topic");
        }
    }
    // Get research sources for a topic
    static async getResearchSources(topicId) {
        try {
            const sources = await prisma_1.prisma.researchSource.findMany({
                where: {
                    topic_id: topicId,
                },
                select: {
                    id: true,
                    title: true,
                    url: true,
                    content: true,
                    relevance: true,
                    created_at: true,
                },
            });
            return sources;
        }
        catch (error) {
            logger_1.default.error("Error fetching research sources:", error);
            throw new Error("Failed to fetch research sources");
        }
    }
}
exports.SearchService = SearchService;
