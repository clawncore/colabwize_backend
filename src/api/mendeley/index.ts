import express, { Request, Response } from "express";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware";
import { MendeleyService } from "../../services/mendeleyService";
import { prisma } from "../../lib/prisma";

const router = express.Router();

/**
 * GET /api/mendeley/library
 * Fetch the user's Mendeley library items
 */
router.get("/library", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { limit = 50, start = 0 } = req.query;

        console.log(`[Mendeley API] Fetching library for user: ${userId}`);
        
        const items = await MendeleyService.fetchLibrary(
            userId, 
            Number(limit), 
            Number(start)
        );

        return res.status(200).json(items);
    } catch (error: any) {
        console.error("[Mendeley API] Library Error:", error.message);
        const statusCode = error.message.includes("reconnect") ? 401 : 500;
        return res.status(statusCode).json({ error: error.message });
    }
});

/**
 * GET /api/mendeley/query
 * Search Mendeley by Title
 */
router.get("/query", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { q } = req.query;

        if (!q) return res.status(400).json({ error: "Search query 'q' is required" });

        console.log(`[Mendeley API] Querying Mendeley for user ${userId}: "${q}"`);

        const items = await MendeleyService.queryItems(userId, String(q));
        return res.status(200).json(items);
    } catch (error: any) {
        console.error("[Mendeley API] Query Error:", error.message);
        const statusCode = error.message.includes("reconnect") ? 401 : 500;
        return res.status(statusCode).json({ error: error.message });
    }
});

/**
 * POST /api/mendeley/import
 * Import selected items from Mendeley to a specific project
 */
router.post("/import", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { projectId, items } = req.body; // items is an array of Mendeley document objects

        if (!projectId || !items || !Array.isArray(items)) {
            return res.status(400).json({ error: "Missing projectId or items array" });
        }

        const results = [];
        for (const item of items) {
            const imported = await MendeleyService.importItem(userId, projectId, item);
            results.push(imported);
        }

        return res.status(200).json({ success: true, importedCount: results.length, data: results });
    } catch (error: any) {
        console.error("Mendeley Import Error:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/mendeley/export
 * Export a citation back to Mendeley (round-trip)
 */
router.post("/export", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { citationId } = req.body;

        if (!citationId) {
            return res.status(400).json({ error: "citationId is required" });
        }

        const citation = await prisma.citation.findFirst({
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

        const created = await MendeleyService.createDocument(userId, documentData);

        return res.status(200).json({
            success: true,
            mendeleyDocumentId: created?.id || 'unknown',
        });
    } catch (error: any) {
        console.error("[Mendeley Export] Error:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

export default router;
