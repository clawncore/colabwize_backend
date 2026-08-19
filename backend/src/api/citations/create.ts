import express, { Request, Response } from "express";
import { CitationConfidenceService } from "../../services/citationConfidenceService";
import logger from "../../monitoring/logger";
import { checkProjectAccess } from "../../lib/auth-helpers";
import { prisma } from "../../lib/prisma";
import { ZoteroService } from "../../services/zoteroService";

const router = express.Router();

/**
 * POST /api/citations/:projectId
 * Add a citation to a project
 */
router.post(
  "/:projectId",
  // checkUsageLimit("citation_check"), // Optional: limit adding citations? Probably not needed.
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
      const {
        title,
        author,
        year,
        type,
        doi,
        url,
        source,
        abstract,
        formatted_citations,
      } = req.body as any;

      if (!projectId) {
        return res.status(400).json({
          success: false,
          error: "Project ID is required",
        });
      }

      if (!title || !author || !year) {
        return res.status(400).json({
          success: false,
          error: "Title, author, and year are required",
        });
      }

      // Verify access to the project
      const hasAccess = await checkProjectAccess(projectId as string, userId);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error:
            "Access denied: You don't have permission to add citations to this project",
        });
      }

      const citation = await CitationConfidenceService.addCitation(
        projectId as string,
        userId,
        {
          title,
          author,
          year,
          type: type || "journal-article",
          doi,
          url,
          source,
          abstract,
          formatted_citations,
        },
      );

      // --- NEW: Master Engine Sync Hook (Research Vault) ---
      try {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { zotero_api_key: true, zotero_user_id: true, zotero_auto_sync: true }
        });

        if (user?.zotero_auto_sync && user.zotero_api_key && user.zotero_user_id) {
          console.log(`[Master-Engine] Auto-vaulting citation: "${title}"`);
          
          const vaultItemData = {
            itemType: "journalArticle",
            title: title,
            creators: author.split(",").map((a: string) => ({
              creatorType: "author",
              name: a.trim()
            })),
            date: year.toString(),
            DOI: doi,
            url: url,
            abstractNote: abstract,
            libraryCatalog: "ColabWize Master Vault"
          };

          await ZoteroService.createItem(
            user.zotero_user_id,
            user.zotero_api_key,
            vaultItemData
          );
        }
      } catch (syncError: any) {
        // We don't want to fail the citation creation if master sync fails, 
        // just log it.
        logger.error("[Master-Engine] Auto-vault failed", {
          error: syncError.message,
          userId,
          title
        });
      }

      return res.status(201).json({
        success: true,
        data: citation,
      });
    } catch (error: any) {
      logger.error("Error adding citation", {
        error: error.message,
        stack: error.stack,
      });

      return res.status(500).json({
        success: false,
        error: error.message || "Failed to add citation",
      });
    }
  },
);

export default router;
