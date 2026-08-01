"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const citationConfidenceService_1 = require("../../services/citationConfidenceService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const auth_helpers_1 = require("../../lib/auth-helpers");
const prisma_1 = require("../../lib/prisma");
const zoteroService_1 = require("../../services/zoteroService");
const router = express_1.default.Router();
/**
 * POST /api/citations/:projectId
 * Add a citation to a project
 */
router.post("/:projectId", 
// checkUsageLimit("citation_check"), // Optional: limit adding citations? Probably not needed.
async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId } = req.params;
        const { title, author, year, type, doi, url, source, abstract, formatted_citations, } = req.body;
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
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: "Access denied: You don't have permission to add citations to this project",
            });
        }
        const citation = await citationConfidenceService_1.CitationConfidenceService.addCitation(projectId, userId, {
            title,
            author,
            year,
            type: type || "journal-article",
            doi,
            url,
            source,
            abstract,
            formatted_citations,
        });
        // --- NEW: Master Engine Sync Hook (Research Vault) ---
        try {
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: { zotero_api_key: true, zotero_user_id: true, zotero_auto_sync: true }
            });
            if (user?.zotero_auto_sync && user.zotero_api_key && user.zotero_user_id) {
                console.log(`[Master-Engine] Auto-vaulting citation: "${title}"`);
                const vaultItemData = {
                    itemType: "journalArticle",
                    title: title,
                    creators: author.split(",").map((a) => ({
                        creatorType: "author",
                        name: a.trim()
                    })),
                    date: year.toString(),
                    DOI: doi,
                    url: url,
                    abstractNote: abstract,
                    libraryCatalog: "ColabWize Master Vault"
                };
                await zoteroService_1.ZoteroService.createItem(user.zotero_user_id, user.zotero_api_key, vaultItemData);
            }
        }
        catch (syncError) {
            // We don't want to fail the citation creation if master sync fails, 
            // just log it.
            logger_1.default.error("[Master-Engine] Auto-vault failed", {
                error: syncError.message,
                userId,
                title
            });
        }
        return res.status(201).json({
            success: true,
            data: citation,
        });
    }
    catch (error) {
        logger_1.default.error("Error adding citation", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(500).json({
            success: false,
            error: error.message || "Failed to add citation",
        });
    }
});
exports.default = router;
