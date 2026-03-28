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
        
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { mendeley_access_token: true }
        });

        if (!user?.mendeley_access_token) {
            return res.status(401).json({ error: "Mendeley account not linked" });
        }

        const { limit = 50, start = 0 } = req.query;
        const items = await MendeleyService.fetchLibrary(
            user.mendeley_access_token, 
            Number(limit), 
            Number(start)
        );

        return res.status(200).json(items);
    } catch (error: any) {
        console.error("Mendeley Library Error:", error.message);
        return res.status(500).json({ error: error.message });
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

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { mendeley_access_token: true }
        });

        if (!user || !user.mendeley_access_token) {
            return res.status(401).json({ error: "Mendeley account not linked" });
        }

        const items = await MendeleyService.queryItems(user.mendeley_access_token, String(q));
        return res.status(200).json(items);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
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
