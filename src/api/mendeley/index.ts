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

export default router;
