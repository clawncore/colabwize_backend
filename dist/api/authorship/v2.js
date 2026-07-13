"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const zod_1 = require("zod");
const auth_1 = require("../../middleware/auth");
const prisma_1 = require("../../lib/prisma");
const authorshipConfidenceService_1 = require("../../services/authorshipConfidenceService");
const authorshipEvidenceService_1 = require("../../services/authorshipEvidenceService");
const router = express_1.default.Router();
const getUserId = (req) => req.user?.id;
const ensureProjectAccess = async (projectId, userId) => {
    const project = await prisma_1.prisma.project.findFirst({
        where: {
            id: projectId,
            OR: [
                { user_id: userId },
                { collaborators: { some: { user_id: userId } } },
                { workspace: { members: { some: { user_id: userId } } } },
            ],
        },
        select: { id: true },
    });
    return Boolean(project);
};
const evidenceStrengthSchema = zod_1.z.enum(["strong", "medium", "weak"]);
const evidenceTypeSchema = zod_1.z.enum([
    "server_observed_edit",
    "collaboration_update",
    "ai_assistance",
    "document_snapshot",
    "client_telemetry",
    "anomaly",
]);
const evidenceSourceSchema = zod_1.z.enum([
    "hocuspocus",
    "editor_api",
    "ai_service",
    "client_sdk",
    "system",
]);
const batchSourceSchema = zod_1.z.enum([
    "server_observed",
    "client_batch",
    "ai_service",
    "system",
]);
const evidenceSchema = zod_1.z.object({
    projectId: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid(),
    evidenceId: zod_1.z.string().max(255),
    evidenceType: evidenceTypeSchema,
    source: evidenceSourceSchema,
    strength: evidenceStrengthSchema,
    sessionId: zod_1.z.string().optional(),
    clientSessionId: zod_1.z.string().optional(),
    collaborationSessionId: zod_1.z.string().uuid().optional(),
    evidenceHash: zod_1.z.string().optional(),
    serverReceivedAt: zod_1.z.string().datetime().optional(),
    eventTimestamp: zod_1.z.string().datetime().optional(),
    blockId: zod_1.z.string().optional(),
    sectionTitle: zod_1.z.string().optional(),
    contentHash: zod_1.z.string().optional(),
    insertedChars: zod_1.z.number().int().nonnegative().optional(),
    deletedChars: zod_1.z.number().int().nonnegative().optional(),
    editCount: zod_1.z.number().int().nonnegative().optional(),
    aiAssisted: zod_1.z.boolean().optional(),
    anomalyScore: zod_1.z.number().nonnegative().max(100).optional(),
    payload: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
});
const evidenceBatchSchema = zod_1.z.object({
    projectId: zod_1.z.string().uuid(),
    sessionId: zod_1.z.string().optional(),
    clientSessionId: zod_1.z.string().optional(),
    source: batchSourceSchema,
    rawPayload: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    evidence: zod_1.z.array(evidenceSchema).min(1).max(500),
});
const editLiteSchema = zod_1.z.object({
    ty: zod_1.z.enum(["is", "ds"]),
    text: zod_1.z.string().optional(),
    loc: zod_1.z.number().optional(),
    si: zod_1.z.number().optional(),
    ei: zod_1.z.number().optional(),
    time: zod_1.z.number(),
    userId: zod_1.z.string(),
});
const copyPasteFindingSchema = editLiteSchema.extend({
    copyPasteReason: zod_1.z.enum(["largeSingleEvent", "rapidInsertionBurst"]),
    copyPasteChars: zod_1.z.number().int().nonnegative(),
    copyPasteDurationMs: zod_1.z.number().int().nonnegative(),
    copyPasteSourceEdits: zod_1.z.number().int().nonnegative(),
});
const writingSessionSchema = zod_1.z.object({
    startTime: zod_1.z.string(),
    endTime: zod_1.z.string(),
    duration: zod_1.z.number().int().nonnegative(),
    revisions: zod_1.z.number().int().nonnegative(),
    editCount: zod_1.z.number().int().nonnegative(),
});
const writingSessionSnapshotSchema = zod_1.z.object({
    projectId: zod_1.z.string().uuid(),
    userId: zod_1.z.string().uuid().optional(),
    clientSessionId: zod_1.z.string().optional(),
    initialContentHash: zod_1.z.string().optional(),
    savedAt: zod_1.z.string().datetime().optional(),
    sessions: zod_1.z.array(writingSessionSchema).max(1000),
    copyPastes: zod_1.z.array(copyPasteFindingSchema).max(500),
    metrics: zod_1.z.object({
        totalTimeMs: zod_1.z.number().nonnegative(),
        editCount: zod_1.z.number().int().nonnegative(),
        averageTypingSpeedCPM: zod_1.z.number().nonnegative(),
        thinkPauseRatio: zod_1.z.number().min(0).max(100),
        copyPasteCount: zod_1.z.number().int().nonnegative(),
    }).optional(),
});
router.post("/v2/evidence/batches", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const parsed = evidenceBatchSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: "Invalid evidence batch payload",
                details: parsed.error.flatten(),
            });
        }
        const batch = parsed.data;
        if (!(await ensureProjectAccess(batch.projectId, userId))) {
            return res.status(403).json({
                success: false,
                error: "You do not have access to this project",
            });
        }
        const hasProjectEvidence = batch.evidence.every((item) => item.userId === userId);
        if (!hasProjectEvidence) {
            return res.status(403).json({
                success: false,
                error: "Evidence batch can only contain evidence for the authenticated user",
            });
        }
        const result = await authorshipEvidenceService_1.AuthorshipEvidenceService.recordEvidenceBatch(batch);
        return res.status(201).json({
            success: true,
            data: result,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Failed to record authorship evidence batch",
        });
    }
});
router.post("/v2/projects/:projectId/writing-sessions", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId } = req.params;
        const parsedProjectId = zod_1.z.string().uuid().safeParse(projectId);
        if (!parsedProjectId.success) {
            return res.status(400).json({
                success: false,
                error: "Project ID is required",
            });
        }
        const parsed = writingSessionSnapshotSchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: "Invalid writing session snapshot payload",
                details: parsed.error.flatten(),
            });
        }
        const snapshot = parsed.data;
        if (snapshot.projectId !== parsedProjectId.data) {
            return res.status(400).json({
                success: false,
                error: "Project ID mismatch",
            });
        }
        if (!(await ensureProjectAccess(parsedProjectId.data, userId))) {
            return res.status(403).json({
                success: false,
                error: "You do not have access to this project",
            });
        }
        if (snapshot.userId && snapshot.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: "Writing session snapshot can only be saved for the authenticated user",
            });
        }
        const result = await authorshipEvidenceService_1.AuthorshipEvidenceService.recordWritingSessionSnapshot({
            ...snapshot,
            userId,
        });
        return res.status(201).json({
            success: true,
            data: result,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Failed to save writing session snapshot",
        });
    }
});
router.get("/v2/projects/:projectId/report", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId } = req.params;
        const parsedProjectId = zod_1.z.string().uuid().safeParse(projectId);
        if (!parsedProjectId.success) {
            return res.status(400).json({
                success: false,
                error: "Project ID is required",
            });
        }
        if (!(await ensureProjectAccess(parsedProjectId.data, userId))) {
            return res.status(403).json({
                success: false,
                error: "You do not have access to this project",
            });
        }
        const report = await authorshipConfidenceService_1.AuthorshipConfidenceService.generateProjectReport(parsedProjectId.data, userId);
        return res.status(200).json({
            success: true,
            data: report,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Failed to generate authorship confidence report",
        });
    }
});
router.get("/v2/projects/:projectId/contributions", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId } = req.params;
        const parsedProjectId = zod_1.z.string().uuid().safeParse(projectId);
        if (!parsedProjectId.success) {
            return res.status(400).json({
                success: false,
                error: "Invalid project ID",
            });
        }
        if (!(await ensureProjectAccess(parsedProjectId.data, userId))) {
            return res.status(403).json({
                success: false,
                error: "You do not have access to this project",
            });
        }
        const contributions = await authorshipEvidenceService_1.AuthorshipEvidenceService.getProjectContributions(parsedProjectId.data);
        return res.status(200).json({
            success: true,
            data: contributions,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Failed to load authorship contributions",
        });
    }
});
router.post("/v2/projects/:projectId/reports", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const { projectId } = req.params;
        const parsedProjectId = zod_1.z.string().uuid().safeParse(projectId);
        if (!parsedProjectId.success) {
            return res.status(400).json({
                success: false,
                error: "Project ID is required",
            });
        }
        if (!(await ensureProjectAccess(parsedProjectId.data, userId))) {
            return res.status(403).json({
                success: false,
                error: "You do not have access to this project",
            });
        }
        const report = await authorshipConfidenceService_1.AuthorshipConfidenceService.generateProjectReport(parsedProjectId.data, userId);
        return res.status(201).json({
            success: true,
            data: report,
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Failed to generate authorship confidence report",
        });
    }
});
router.post("/v2/anomalies", auth_1.authenticateExpressRequest, async (req, res) => {
    try {
        const userId = getUserId(req);
        if (!userId) {
            return res.status(401).json({
                success: false,
                error: "Authentication required",
            });
        }
        const anomalySchema = zod_1.z.object({
            projectId: zod_1.z.string().uuid(),
            userId: zod_1.z.string().uuid().optional(),
            evidenceId: zod_1.z.string().optional(),
            anomalyType: zod_1.z.string().max(120),
            severity: zod_1.z.enum(["low", "medium", "high", "critical"]),
            score: zod_1.z.number().nonnegative().max(100),
            message: zod_1.z.string().max(500),
            metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
            detectedAt: zod_1.z.string().datetime().optional(),
        });
        const parsed = anomalySchema.safeParse(req.body);
        if (!parsed.success) {
            return res.status(400).json({
                success: false,
                error: "Invalid anomaly payload",
                details: parsed.error.flatten(),
            });
        }
        if (!(await ensureProjectAccess(parsed.data.projectId, userId))) {
            return res.status(403).json({
                success: false,
                error: "You do not have access to this project",
            });
        }
        if (parsed.data.userId && parsed.data.userId !== userId) {
            return res.status(403).json({
                success: false,
                error: "Anomalies can only be recorded for the authenticated user",
            });
        }
        const anomalyId = await authorshipEvidenceService_1.AuthorshipEvidenceService.recordAnomaly({
            ...parsed.data,
            userId,
        });
        return res.status(201).json({
            success: true,
            data: { anomalyId },
        });
    }
    catch (error) {
        return res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : "Failed to record authorship anomaly",
        });
    }
});
exports.default = router;
