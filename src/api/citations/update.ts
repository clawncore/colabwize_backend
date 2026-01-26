import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import logger from "../../monitoring/logger";

const router = express.Router();
const prisma = new PrismaClient();

/**
 * PUT /api/citations/:projectId/:citationId
 * Update citation themes or matrix notes
 */
router.put(
    "/:projectId/:citationId",
    async (req: Request, res: Response) => {
        try {
            const userId = (req as any).user?.id;
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: "Authentication required",
                });
            }

            const { projectId, citationId } = req.params;
            const { themes, matrix_notes } = req.body as { themes?: string[]; matrix_notes?: string };

            if (!projectId || !citationId) {
                return res.status(400).json({
                    success: false,
                    error: "Project ID and Citation ID are required",
                });
            }

            const citation = await (prisma.citation as any).update({
                where: {
                    id: citationId
                },
                data: {
                    themes: themes,
                    matrix_notes: matrix_notes
                }
            });

            return res.status(200).json({
                success: true,
                data: citation,
            });
        } catch (error: any) {
            logger.error("Error updating citation themes", {
                error: error.message,
                stack: error.stack,
            });

            return res.status(500).json({
                success: false,
                error: error.message || "Failed to update citation themes",
            });
        }
    }
);

export default router;
