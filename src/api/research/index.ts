import express, { Request, Response } from "express";
import { initializePrisma } from "../../lib/prisma-async";
import logger from "../../monitoring/logger";

const router = express.Router();

interface AuthenticatedRequest extends Request {
    user?: {
        id: string;
        email: string;
    };
}

/**
 * GET /api/research/topics/recent
 * Get recent research topics for the authenticated user
 */
router.get("/topics/recent", async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const limit = parseInt(req.query.limit as string) || 10;
        const prisma = await initializePrisma();

        // @ts-ignore - ResearchTopic might not be in types yet if generate failed
        const topics = await prisma.researchTopic.findMany({
            where: { user_id: userId },
            orderBy: { created_at: "desc" },
            take: limit,
        });

        return res.json({
            success: true,
            data: topics.map((t: any) => ({
                id: t.id,
                title: t.title,
                description: t.description,
                sources: t.sources,
                sourcesData: t.sources_data,
                lastUpdated: t.updated_at.toISOString().split('T')[0]
            }))
        });
    } catch (error: any) {
        logger.error("Failed to fetch research topics", { error: error.message });
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
});

/**
 * POST /api/research/topics
 * Save a new research topic
 */
router.post("/topics", async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const { title, description, sources, sourcesData } = req.body;
        const prisma = await initializePrisma();

        // @ts-ignore
        const topic = await prisma.researchTopic.create({
            data: {
                user_id: userId,
                title,
                description,
                sources: sources || 0,
                sources_data: sourcesData || [],
            },
        });

        return res.status(201).json({
            success: true,
            data: {
                id: topic.id,
                title: topic.title,
                description: topic.description,
                sources: topic.sources,
                sourcesData: topic.sources_data,
                lastUpdated: topic.updated_at.toISOString().split('T')[0]
            }
        });
    } catch (error: any) {
        logger.error("Failed to save research topic", { error: error.message });
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
});

/**
 * DELETE /api/research/topics/:id
 * Delete a research topic
 */
router.delete("/topics/:id", async (req: Request, res: Response) => {
    try {
        const userId = (req as AuthenticatedRequest).user?.id;
        if (!userId) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const { id } = req.params;
        const prisma = await initializePrisma();

        // @ts-ignore
        await prisma.researchTopic.deleteMany({
            where: {
                id: String(id), // Explicitly cast to string to satisfy type checker
                user_id: userId,
            },
        });

        return res.json({ success: true, message: "Topic deleted" });
    } catch (error: any) {
        logger.error("Failed to delete research topic", { error: error.message });
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
});

export default router;
