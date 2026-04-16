import express, { Request, Response } from "express";
import { authenticateHybridRequest } from "../../middleware/hybridAuthMiddleware.js";
import { ZoteroService } from "../../services/zoteroService.js";
import { prisma } from "../../lib/prisma.js";
import axios from "axios";
import logger from "../../monitoring/logger.js";

const router = express.Router();

/**
 * GET /api/zotero/library
 * Fetch the user's Zotero library items
 */
router.get("/library", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        
        // Force fresh response (disable Express ETag for this route)
        res.set('ETag', 'false');
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

        // Fetch Zotero credentials from DB
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { zotero_api_key: true, zotero_user_id: true }
        });

        if (!user?.zotero_api_key || !user?.zotero_user_id) {
            logger.warn(`[Zotero Library] Missing credentials for user: ${userId}`);
            return res.status(401).json({ error: "Zotero account not linked or credentials missing in local database." });
        }

        logger.info(`[Zotero Library] Fetching from API for Zotero ID: ${user.zotero_user_id}`);
        const { limit = 50, start = 0 } = req.query;
        const items = await ZoteroService.fetchLibrary(
            user.zotero_user_id, 
            user.zotero_api_key, 
            Number(limit), 
            Number(start)
        );

        console.log("[Zotero Library] Successfully fetched items count:", items.length);
        return res.status(200).json(items);
    } catch (error: any) {
        console.error("[Zotero Library Error]:", error.message);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/zotero/debug
 * Diagnostic endpoint for Zotero integration
 */
router.get("/debug", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { 
                id: true, 
                zotero_user_id: true,
                zotero_api_key: true 
            }
        });

        return res.json({
            status: "success",
            diagnostics: {
                hasZoteroUserId: !!user?.zotero_user_id,
                hasZoteroApiKey: !!user?.zotero_api_key,
                zoteroId: user?.zotero_user_id,
                apiKeyPreview: user?.zotero_api_key ? user.zotero_api_key.substring(0, 4) + "..." : null,
                nodeEnv: process.env.NODE_ENV,
            },
            userObject: {
                id: user?.id,
            }
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/zotero/import
 * Import selected items from Zotero to a specific project
 */
router.post("/import", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { projectId, items } = req.body; // items is an array of CSL-JSON objects

        if (!projectId || !items || !Array.isArray(items)) {
            return res.status(400).json({ error: "Missing projectId or items array" });
        }

        const results = [];
        for (const item of items) {
            const imported = await ZoteroService.importItem(userId, projectId, item);
            results.push(imported);
        }

        return res.status(200).json({ success: true, importedCount: results.length, data: results });
    } catch (error: any) {
        console.error("Zotero Import Route Critical Error:", error.stack || error.message);
        console.error("Incoming Body:", JSON.stringify(req.body).substring(0, 500) + "...");
        return res.status(500).json({ error: error.message, stack: error.stack });
    }
});

/**
 * GET /api/zotero/query
 * Search Zotero by DOI, ISBN, or Title
 */
router.get("/query", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { q } = req.query;

        if (!q) return res.status(400).json({ error: "Search query 'q' is required" });

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { zotero_api_key: true, zotero_user_id: true }
        });

        if (!user || !user.zotero_api_key || !user.zotero_user_id) {
            return res.status(401).json({ error: "Zotero account not linked" });
        }

        const items = await ZoteroService.queryItems(user.zotero_user_id, user.zotero_api_key, String(q));
        return res.status(200).json(items);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/zotero/attachments/:itemKey
 * Fetch child attachments for a Zotero item
 */
router.get("/attachments/:itemKey", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { itemKey } = req.params;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { zotero_api_key: true, zotero_user_id: true }
        });

        if (!user || !user.zotero_api_key || !user.zotero_user_id) {
            return res.status(401).json({ error: "Zotero account not linked" });
        }

        const attachments = await ZoteroService.fetchAttachments(user.zotero_user_id, user.zotero_api_key, String(itemKey));
        return res.status(200).json(attachments);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/zotero/format/:itemKey
 * Get formatted bib string for an item
 */
router.get("/format/:itemKey", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { itemKey } = req.params;
        const { style = 'apa' } = req.query;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { zotero_api_key: true, zotero_user_id: true }
        });

        if (!user || !user.zotero_api_key || !user.zotero_user_id) {
            return res.status(401).json({ error: "Zotero account not linked" });
        }

        const formatted = await ZoteroService.fetchFormattedBib(user.zotero_user_id, user.zotero_api_key, String(itemKey), String(style));
        return res.status(200).json(formatted);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * PATCH /api/zotero/items/:itemKey
 * Update a Zotero item (metadata/notes)
 */
router.patch("/items/:itemKey", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { itemKey } = req.params;
        const updateData = req.body;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { zotero_api_key: true, zotero_user_id: true }
        });

        if (!user || !user.zotero_api_key || !user.zotero_user_id) {
            return res.status(401).json({ error: "Zotero account not linked" });
        }

        const updated = await ZoteroService.updateItem(user.zotero_user_id, user.zotero_api_key, String(itemKey), updateData);
        return res.status(200).json(updated);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/zotero/file/:itemKey
 * Proxy PDF download from Zotero
 */
router.get("/file/:itemKey", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { itemKey } = req.params;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { zotero_api_key: true, zotero_user_id: true }
        });

        if (!user || !user.zotero_api_key || !user.zotero_user_id) {
            return res.status(401).json({ error: "Zotero account not linked" });
        }

        const url = `https://api.zotero.org/users/${user.zotero_user_id}/items/${itemKey}/file`;
        
        const response = await axios.get(url, {
            headers: { 'Zotero-API-Key': user.zotero_api_key },
            responseType: 'stream'
        });

        // Forward headers
        res.setHeader('Content-Type', response.headers['content-type']);
        res.setHeader('Content-Disposition', response.headers['content-disposition']);
        
        response.data.pipe(res);
    } catch (error: any) {
        console.error("Zotero File Proxy Error:", error.message);
        return res.status(500).json({ error: "Failed to download file from Zotero" });
    }
});

/**
 * POST /api/zotero/items
 * Create a new item in Zotero
 */
router.post("/items", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const itemData = req.body;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { zotero_api_key: true, zotero_user_id: true }
        });

        if (!user || !user.zotero_api_key || !user.zotero_user_id) {
            return res.status(401).json({ error: "Zotero account not linked" });
        }

        const created = await ZoteroService.createItem(user.zotero_user_id, user.zotero_api_key, itemData);
        return res.status(201).json(created);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/zotero/items/:itemKey/notes
 * Create a child note for a Zotero item
 */
router.post("/items/:itemKey/notes", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { itemKey } = req.params;
        const { note } = req.body;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { zotero_api_key: true, zotero_user_id: true }
        });

        if (!user || !user.zotero_api_key || !user.zotero_user_id) {
            return res.status(401).json({ error: "Zotero account not linked" });
        }

        const created = await ZoteroService.createNote(user.zotero_user_id, user.zotero_api_key, String(itemKey), note);
        return res.status(201).json(created);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/zotero/collections
 * Fetch user's Zotero collections
 */
router.get("/collections", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { zotero_api_key: true, zotero_user_id: true }
        });

        if (!user || !user.zotero_api_key || !user.zotero_user_id) {
            return res.status(401).json({ error: "Zotero account not linked" });
        }

        const collections = await ZoteroService.fetchCollections(user.zotero_user_id, user.zotero_api_key);
        return res.status(200).json(collections);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/zotero/collections/:collectionKey/items
 * Fetch items for a specific Zotero collection
 */
router.get("/collections/:collectionKey/items", authenticateHybridRequest, async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { collectionKey } = req.params;
        const { limit = 50, start = 0 } = req.query;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { zotero_api_key: true, zotero_user_id: true }
        });

        if (!user || !user.zotero_api_key || !user.zotero_user_id) {
            return res.status(401).json({ error: "Zotero account not linked" });
        }

        const items = await ZoteroService.fetchCollectionItems(user.zotero_user_id, user.zotero_api_key, String(collectionKey), Number(limit), Number(start));
        return res.status(200).json(items);
    } catch (error: any) {
        return res.status(500).json({ error: error.message });
    }
});

export default router;
