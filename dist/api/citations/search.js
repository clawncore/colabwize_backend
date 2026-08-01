"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const logger_1 = __importDefault(require("../../monitoring/logger"));
const academicSearchService_1 = require("../../services/academicSearchService");
const BillingGateway_1 = require("../../billing/BillingGateway");
const router = express_1.default.Router();
/**
 * GET /api/citations/search
 * Search for papers using AcademicSearchService (Semantic Scholar -> OpenAlex)
 * Query params: q (search query)
 */
router.get("/search", async (req, res) => {
    await handleSearch(req, res);
});
/**
 * GET /api/citations/search-external
 * Alias for /search used by some frontend components
 */
router.get("/search-external", async (req, res) => {
    await handleSearch(req, res);
});
async function handleSearch(req, res) {
    try {
        const authReq = req;
        const userId = authReq.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const query = req.query.q;
        // `enrich=1` marks an auto-enrichment call (background metadata fetch
        // when citations are detected on editor load). These are FREE — only
        // intentional user searches (the Search button) count against quota.
        const isEnrichment = req.query.enrich === "1";
        if (!query) {
            return res.status(400).json({
                success: false,
                message: "Search query is required",
            });
        }
        console.log(`Searching Academic Papers for: ${query} (enrich: ${isEnrichment})`);
        // Auto-enrichment bypasses the billing gate entirely — it's a background
        // metadata fetch, not a user-initiated search. Only manual searches run
        // through the hold → execute → confirm/release pipeline.
        if (isEnrichment) {
            try {
                const papers = await academicSearchService_1.AcademicSearchService.searchPapers(query);
                return res.status(200).json({ success: true, data: papers });
            }
            catch (error) {
                logger_1.default.error("Error auto-enriching papers", { error: error.message });
                return res.status(500).json({ success: false, message: "Failed to search papers" });
            }
        }
        // Manual search: run through the single billing pipeline.
        try {
            const papers = await BillingGateway_1.BillingGateway.withFeature(userId, "paper_search", undefined, () => academicSearchService_1.AcademicSearchService.searchPapers(query));
            return res.status(200).json({
                success: true,
                data: papers,
            });
        }
        catch (e) {
            if (e instanceof BillingGateway_1.BillingError) {
                const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
                return res.status(status).json({
                    success: false,
                    message: e.message || "Monthly search limit reached",
                    code: e.code,
                    requiresUpgrade: true,
                    ...e.data,
                });
            }
            throw e;
        }
    }
    catch (error) {
        logger_1.default.error("Error searching academic papers", { error: error.message });
        return res.status(500).json({
            success: false,
            message: "Failed to search for papers",
        });
    }
}
/**
 * POST /api/citations/legitimize
 * Find evidence for a specific factual claim
 */
router.post("/legitimize", async (req, res) => {
    try {
        const authReq = req;
        const userId = authReq.user?.id;
        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "Authentication required",
            });
        }
        const { claim, context } = req.body;
        void context;
        if (!claim) {
            return res.status(400).json({
                success: false,
                message: "Claim text is required",
            });
        }
        // Run through the single billing pipeline (hold → execute →
        // confirm/release), consuming paper_search quota.
        // Use the claim directly as the evidence search query.
        const papers = await BillingGateway_1.BillingGateway.withFeature(userId, "paper_search", undefined, () => academicSearchService_1.AcademicSearchService.findEvidenceForClaim(claim));
        return res.status(200).json({
            success: true,
            data: papers,
            message: papers.length > 0 ? "Evidence found" : "No direct evidence found",
        });
    }
    catch (e) {
        if (e instanceof BillingGateway_1.BillingError) {
            const status = e.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
            return res.status(status).json({
                success: false,
                message: e.message || "Monthly search limit reached",
                code: e.code,
                requiresUpgrade: true,
                ...e.data,
            });
        }
        logger_1.default.error("Error legitimizing claim", { error: e.message });
        return res.status(500).json({
            success: false,
            message: "Failed to find evidence",
        });
    }
});
exports.default = router;
