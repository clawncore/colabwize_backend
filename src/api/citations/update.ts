import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import logger from "../../monitoring/logger";

const router = express.Router();
const prisma = new PrismaClient();

/**
 * PUT /api/citations/:projectId/:citationId
 * Update citation themes or matrix notes
 */
router.put("/:projectId/:citationId", async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "Authentication required",
      });
    }

    const { projectId, citationId } = req.params;
    const {
      themes,
      matrix_notes,
      title,
      author,
      authors, // Handle both singular and plural from frontend
      year,
      url,
      doi,
      journal,
      volume,
      issue,
      pages,
      publisher,
      type,
      abstract,
      formatted_citations,
    } = req.body as {
      themes?: string[];
      matrix_notes?: string;
      title?: string;
      author?: string;
      authors?: string[];
      year?: number;
      url?: string;
      doi?: string;
      journal?: string;
      volume?: string;
      issue?: string;
      pages?: string;
      publisher?: string;
      type?: string;
      abstract?: string;
      formatted_citations?: any;
    };

    if (!projectId || !citationId) {
      return res.status(400).json({
        success: false,
        error: "Project ID and Citation ID are required",
      });
    }

    const updateData: any = {};
    if (themes !== undefined) updateData.themes = themes;
    if (matrix_notes !== undefined) updateData.matrix_notes = matrix_notes;
    if (title !== undefined) updateData.title = title;

    // Handle author transition: Prefer authors array if provided, fallback to author string
    if (authors !== undefined && Array.isArray(authors)) {
      updateData.author = authors.join(", ");
    } else if (author !== undefined) {
      updateData.author = author;
    }

    if (year !== undefined) updateData.year = year;
    if (url !== undefined) updateData.url = url;
    if (doi !== undefined) updateData.doi = doi;
    if (journal !== undefined) updateData.journal = journal;
    if (volume !== undefined) updateData.volume = volume;
    if (issue !== undefined) updateData.issue = issue;
    if (pages !== undefined) updateData.pages = pages;
    if (publisher !== undefined) updateData.publisher = publisher;
    if (type !== undefined) updateData.type = type;
    if (abstract !== undefined) updateData.abstract = abstract;
    if (formatted_citations !== undefined)
      updateData.formatted_citations = formatted_citations;

    const citation = await (prisma.citation as any).update({
      where: {
        id: citationId,
      },
      data: updateData,
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
});

export default router;
