"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = require("../../lib/prisma");
const api_response_1 = require("../../lib/api-response");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const authorshipConfidenceService_1 = require("../../services/authorshipConfidenceService");
const router = express_1.default.Router();
/**
 * GET /api/certificates/verify/:certificateId
 * Public verification endpoint
 */
router.get("/verify/:certificateId", async (req, res) => {
    try {
        const { certificateId } = req.params;
        if (!certificateId) {
            return (0, api_response_1.sendErrorResponse)(res, 400, "Certificate ID is required");
        }
        // Find certificate
        const certificate = await prisma_1.prisma.certificate.findUnique({
            where: { id: certificateId },
            include: {
                user: {
                    select: {
                        full_name: true,
                    },
                },
                project: {
                    select: {
                        title: true,
                        word_count: true,
                    },
                },
            },
        });
        if (!certificate) {
            return (0, api_response_1.sendErrorResponse)(res, 404, "Certificate not found");
        }
        const confidenceReport = certificate.project_id
            ? await authorshipConfidenceService_1.AuthorshipConfidenceService.getLatestReport(certificate.project_id, certificate.user_id).catch(() => null)
            : null;
        // Return limited public data
        const publicData = {
            id: certificate.id,
            isValid: true,
            issuedAt: certificate.created_at,
            recipient: certificate.user?.full_name || "ColabWize User",
            projectTitle: certificate.project?.title || "Untitled Project",
            wordCount: certificate.project?.word_count || 0,
            metadata: certificate.metadata,
            confidenceReport: confidenceReport ? {
                overallReliability: confidenceReport.overallReliability,
                attributionConfidence: confidenceReport.attributionConfidence,
                contributionConfidence: confidenceReport.contributionConfidence,
                collaborationClarity: confidenceReport.collaborationClarity,
                evidenceCompleteness: confidenceReport.evidenceCompleteness,
                aiAssistanceTransparency: confidenceReport.aiAssistanceTransparency,
                anomalyRisk: confidenceReport.anomalyRisk,
                evidenceSummary: confidenceReport.evidenceSummary,
                limitations: confidenceReport.limitations,
            } : null,
            status: certificate.status,
        };
        return (0, api_response_1.sendJsonResponse)(res, 200, publicData);
    }
    catch (error) {
        logger_1.default.error("Error verifying certificate", { error: error.message });
        return (0, api_response_1.sendErrorResponse)(res, 500, "Failed to verify certificate");
    }
});
exports.default = router;
