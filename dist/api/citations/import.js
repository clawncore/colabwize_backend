"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const logger_1 = __importDefault(require("../../monitoring/logger"));
const crossRefService_1 = require("../../services/crossRefService");
const axios_1 = __importDefault(require("axios"));
const router = express_1.default.Router();
/**
 * POST /api/citations/import/doi
 * Fetch metadata for a DOI
 */
router.post("/doi", async (req, res) => {
    try {
        const { doi } = req.body;
        if (!doi) {
            return res.status(400).json({ success: false, message: "DOI is required" });
        }
        // Use the centralized CrossRef service
        const paper = await crossRefService_1.CrossRefService.getWorkByDOI(doi);
        if (paper) {
            return res.json({
                success: true,
                data: {
                    title: paper.title,
                    authors: paper.authors,
                    year: paper.year,
                    doi: paper.id, // paper.id is the DOI in CrossRefService
                    url: paper.url,
                    journal: paper.venue,
                    source: "crossref",
                    type: "journal-article"
                }
            });
        }
        return res.status(404).json({ success: false, message: "DOI not found" });
    }
    catch (error) {
        logger_1.default.error("DOI import failed", { error: error.message, doi: req.body.doi });
        return res.status(500).json({ success: false, message: "Failed to fetch DOI metadata" });
    }
});
/**
 * POST /api/citations/import/url
 * Fetch metadata for a URL
 */
router.post("/url", async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ success: false, message: "URL is required" });
        }
        const response = await axios_1.default.get(url, {
            timeout: 10000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
        });
        const html = response.data;
        // Extract Title
        let title = "";
        const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
        if (titleMatch)
            title = titleMatch[1];
        const ogTitleMatch = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["'](.*?)["']/i);
        if (ogTitleMatch)
            title = ogTitleMatch[1];
        // Extract Author
        let author = "";
        const authorMatch = html.match(/<meta[^>]+name=["']author["'][^>]+content=["'](.*?)["']/i);
        if (authorMatch)
            author = authorMatch[1];
        const articleAuthorMatch = html.match(/<meta[^>]+property=["']article:author["'][^>]+content=["'](.*?)["']/i);
        if (articleAuthorMatch)
            author = articleAuthorMatch[1];
        // Extract Site Name
        let siteName = new URL(url).hostname;
        const ogSiteMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["'](.*?)["']/i);
        if (ogSiteMatch)
            siteName = ogSiteMatch[1];
        // Try to find a date for the year
        let year = new Date().getFullYear();
        const dateMatch = html.match(/(\d{4})[-\/]\d{2}[-\/]\d{2}/);
        if (dateMatch) {
            year = parseInt(dateMatch[1]);
        }
        const metaDateMatch = html.match(/<meta[^>]+(?:property=["']article:published_time["']|name=["'](?:date|pubdate)["'])[^>]+content=["'](\d{4})/i);
        if (metaDateMatch) {
            year = parseInt(metaDateMatch[1]);
        }
        return res.json({
            success: true,
            data: {
                title: title.trim(),
                authors: author ? [author.trim()] : [],
                year,
                url,
                journal: siteName,
                source: "web",
                type: "website"
            }
        });
    }
    catch (error) {
        logger_1.default.error("URL import failed", { error: error.message, url: req.body.url });
        return res.status(500).json({ success: false, message: "Failed to fetch URL metadata" });
    }
});
exports.default = router;
