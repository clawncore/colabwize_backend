"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const logger_1 = __importDefault(require("../../monitoring/logger"));
const prisma_1 = require("../../lib/prisma");
const auth_helpers_1 = require("../../lib/auth-helpers");
const router = express_1.default.Router();
/**
 * PUT /api/citations/:projectId/:citationId
 * Update citation themes or matrix notes
 */
router.put("/:projectId/:citationId", async (req, res) => {
    try {
        const userId = req.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId, citationId } = req.params;
        const { themes, matrix_notes, title, author, authors, // Handle both singular and plural from frontend
        year, url, doi, journal, volume, issue, pages, publisher, type, abstract, formatted_citations, } = req.body;
        if (!projectId || !citationId) {
            return res.status(400).json({
                success: false,
                error: "Project ID and Citation ID are required",
            });
        }
        // Verify access to the project
        const hasAccess = await (0, auth_helpers_1.checkProjectAccess)(projectId, userId);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: "Access denied: You don't have permission to edit citations in this project",
            });
        }
        // Verify citation belongs to this project
        const existingCitation = await prisma_1.prisma.citation.findUnique({
            where: { id: citationId },
            select: { project_id: true },
        });
        if (!existingCitation || existingCitation.project_id !== projectId) {
            return res.status(404).json({
                success: false,
                error: "Citation not found in this project",
            });
        }
        const updateData = {};
        if (themes !== undefined)
            updateData.themes = themes;
        if (matrix_notes !== undefined)
            updateData.matrix_notes = matrix_notes;
        if (title !== undefined)
            updateData.title = title;
        // Handle author transition: Prefer authors array if provided, fallback to author string
        if (authors !== undefined && Array.isArray(authors)) {
            updateData.author = authors.join(", ");
        }
        else if (author !== undefined) {
            updateData.author = author;
        }
        if (year !== undefined)
            updateData.year = year;
        if (url !== undefined)
            updateData.url = url;
        if (doi !== undefined)
            updateData.doi = doi;
        if (journal !== undefined)
            updateData.journal = journal;
        if (volume !== undefined)
            updateData.volume = volume;
        if (issue !== undefined)
            updateData.issue = issue;
        if (pages !== undefined)
            updateData.pages = pages;
        if (publisher !== undefined)
            updateData.publisher = publisher;
        if (type !== undefined)
            updateData.type = type;
        if (abstract !== undefined)
            updateData.abstract = abstract;
        if (formatted_citations !== undefined)
            updateData.formatted_citations = formatted_citations;
        const citation = await prisma_1.prisma.citation.update({
            where: {
                id: citationId,
            },
            data: updateData,
        });
        return res.status(200).json({
            success: true,
            data: citation,
        });
    }
    catch (error) {
        logger_1.default.error("Error updating citation themes", {
            error: error.message,
            stack: error.stack,
        });
        return res.status(500).json({
            success: false,
            error: error.message || "Failed to update citation themes",
        });
    }
});
exports.default = router;
