"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const hybridAuthMiddleware_1 = require("../../middleware/hybridAuthMiddleware");
const rateLimiter_1 = require("../../middleware/rateLimiter");
const mendeleyService_1 = require("../../services/mendeleyService");
const prisma_1 = require("../../lib/prisma");
const router = express_1.default.Router();
/**
 * GET /api/mendeley/library
 * Fetch the user's Mendeley library items
 */
router.get("/library", rateLimiter_1.providerApiLimiter, hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        const { limit = 50, start = 0 } = req.query;
        const items = await mendeleyService_1.MendeleyService.fetchLibrary(userId, Number(limit), Number(start));
        return res.status(200).json(items);
    }
    catch (error) {
        console.error("[Mendeley API] Library Error:", error.message);
        const statusCode = error.message.includes("reconnect") ? 401 : 500;
        return res.status(statusCode).json({ error: error.message });
    }
});
/**
 * GET /api/mendeley/query
 * Search Mendeley by Title
 */
router.get("/query", rateLimiter_1.providerApiLimiter, hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        const { q } = req.query;
        if (!q)
            return res.status(400).json({ error: "Search query 'q' is required" });
        const items = await mendeleyService_1.MendeleyService.queryItems(userId, String(q));
        return res.status(200).json(items);
    }
    catch (error) {
        console.error("[Mendeley API] Query Error:", error.message);
        const statusCode = error.message.includes("reconnect") ? 401 : 500;
        return res.status(statusCode).json({ error: error.message });
    }
});
/**
 * POST /api/mendeley/import
 * Import selected items from Mendeley to a specific project
 */
router.post("/import", rateLimiter_1.providerApiLimiter, hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        const { projectId, items } = req.body; // items is an array of Mendeley document objects
        if (!projectId || !items || !Array.isArray(items)) {
            return res.status(400).json({ error: "Missing projectId or items array" });
        }
        // Cap import size to prevent DB row exhaustion
        const MAX_IMPORT_ITEMS = 500;
        if (items.length > MAX_IMPORT_ITEMS) {
            return res.status(400).json({ error: `Too many items. Maximum is ${MAX_IMPORT_ITEMS} per import.` });
        }
        const results = [];
        for (const item of items) {
            const imported = await mendeleyService_1.MendeleyService.importItem(userId, projectId, item);
            results.push(imported);
        }
        return res.status(200).json({ success: true, importedCount: results.length, data: results });
    }
    catch (error) {
        console.error("Mendeley Import Error:", error.message);
        return res.status(500).json({ error: error.message });
    }
});
/**
 * POST /api/mendeley/export
 * Export a citation back to Mendeley (round-trip)
 */
router.post("/export", rateLimiter_1.providerApiLimiter, hybridAuthMiddleware_1.authenticateHybridRequest, async (req, res) => {
    try {
        const userId = req.user.id;
        const { citationId } = req.body;
        if (!citationId) {
            return res.status(400).json({ error: "citationId is required" });
        }
        const citation = await prisma_1.prisma.citation.findFirst({
            where: { id: citationId, user_id: userId },
        });
        if (!citation) {
            return res.status(404).json({ error: "Citation not found" });
        }
        // Reconstruct Mendeley document from rawMetadata or formatted data
        const documentData = citation.rawMetadata || {
            title: citation.title,
            type: citation.type || 'journal_article',
            authors: citation.author ? [{ first_name: '', last_name: citation.author }] : [],
            year: citation.year,
            doi: citation.doi,
            websites: citation.url ? [citation.url] : [],
            source: citation.journal,
            publisher: citation.publisher,
            volume: citation.volume,
            issue: citation.issue,
            pages: citation.pages,
            abstract: citation.abstract,
        };
        const created = await mendeleyService_1.MendeleyService.createDocument(userId, documentData);
        return res.status(200).json({
            success: true,
            mendeleyDocumentId: created?.id || 'unknown',
        });
    }
    catch (error) {
        console.error("[Mendeley Export] Error:", error.message);
        return res.status(500).json({ error: error.message });
    }
});
exports.default = router;
