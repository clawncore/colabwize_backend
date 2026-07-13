import express, { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import logger from "../../monitoring/logger";
import { checkProjectAccess } from "../../lib/auth-helpers";

const router = express.Router();

/**
 * GET /api/citations/:projectId
 * Get all citations for a project
 */
router.get(
    "/:projectId",
    async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: "Authentication required",
                });
            }

            const { projectId } = req.params;

            if (!projectId) {
                return res.status(400).json({
                    success: false,
                    error: "Project ID is required",
                });
            }

            // Verify access to the project
            const hasAccess = await checkProjectAccess(projectId as string, userId);

            if (!hasAccess) {
                return res.status(403).json({
                    success: false,
                    error: "Access denied or project not found",
                });
            }

            const citations = await prisma.citation.findMany({
                where: {
                    project_id: projectId,
                },
                orderBy: {
                    created_at: 'desc'
                }
            });

            // Maintain legacy response mapping expectations if any client strictly relies on it
            // but returning raw from DB is normally sufficient if it matches StoredCitation
            return res.status(200).json({
                success: true,
                data: citations,
            });
        } catch (error: any) {
            logger.error("Error fetching citations", {
                error: error.message,
                stack: error.stack,
                projectId: req.params.projectId
            });

            return res.status(500).json({
                success: false,
                error: error.message || "Failed to fetch citations",
            });
        }
    }
);

export default router;
