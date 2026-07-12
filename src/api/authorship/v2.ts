import express, { Request, Response } from "express";
import { z } from "zod";
import { authenticateExpressRequest } from "../../middleware/auth";
import { prisma } from "../../lib/prisma";
import { AuthorshipConfidenceService } from "../../services/authorshipConfidenceService";
import { AuthorshipEvidenceService } from "../../services/authorshipEvidenceService";
import { AuthorshipContributionDetail } from "../../types/authorshipEvidence";

const router = express.Router();

type AuthenticatedRequest = Request & {
  user?: {
    id?: string;
  };
};

const getUserId = (req: AuthenticatedRequest) => req.user?.id;

const ensureProjectAccess = async (projectId: string, userId: string) => {
  const project = await prisma.project.findFirst({
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

const evidenceStrengthSchema = z.enum(["strong", "medium", "weak"]);
const evidenceTypeSchema = z.enum([
  "server_observed_edit",
  "collaboration_update",
  "ai_assistance",
  "document_snapshot",
  "client_telemetry",
  "anomaly",
]);
const evidenceSourceSchema = z.enum([
  "hocuspocus",
  "editor_api",
  "ai_service",
  "client_sdk",
  "system",
]);
const batchSourceSchema = z.enum([
  "server_observed",
  "client_batch",
  "ai_service",
  "system",
]);

const evidenceSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  evidenceId: z.string().max(255),
  evidenceType: evidenceTypeSchema,
  source: evidenceSourceSchema,
  strength: evidenceStrengthSchema,
  sessionId: z.string().optional(),
  clientSessionId: z.string().optional(),
  collaborationSessionId: z.string().uuid().optional(),
  evidenceHash: z.string().optional(),
  serverReceivedAt: z.string().datetime().optional(),
  eventTimestamp: z.string().datetime().optional(),
  blockId: z.string().optional(),
  sectionTitle: z.string().optional(),
  contentHash: z.string().optional(),
  insertedChars: z.number().int().nonnegative().optional(),
  deletedChars: z.number().int().nonnegative().optional(),
  editCount: z.number().int().nonnegative().optional(),
  aiAssisted: z.boolean().optional(),
  anomalyScore: z.number().nonnegative().max(100).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const evidenceBatchSchema = z.object({
  projectId: z.string().uuid(),
  sessionId: z.string().optional(),
  clientSessionId: z.string().optional(),
  source: batchSourceSchema,
  rawPayload: z.record(z.string(), z.unknown()).optional(),
  evidence: z.array(evidenceSchema).min(1).max(500),
});

const editLiteSchema = z.object({
  ty: z.enum(["is", "ds"]),
  text: z.string().optional(),
  loc: z.number().optional(),
  si: z.number().optional(),
  ei: z.number().optional(),
  time: z.number(),
  userId: z.string(),
});

const copyPasteFindingSchema = editLiteSchema.extend({
  copyPasteReason: z.enum(["largeSingleEvent", "rapidInsertionBurst"]),
  copyPasteChars: z.number().int().nonnegative(),
  copyPasteDurationMs: z.number().int().nonnegative(),
  copyPasteSourceEdits: z.number().int().nonnegative(),
});

const writingSessionSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  duration: z.number().int().nonnegative(),
  revisions: z.number().int().nonnegative(),
  editCount: z.number().int().nonnegative(),
});

const writingSessionSnapshotSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid().optional(),
  clientSessionId: z.string().optional(),
  initialContentHash: z.string().optional(),
  savedAt: z.string().datetime().optional(),
  sessions: z.array(writingSessionSchema).max(1000),
  copyPastes: z.array(copyPasteFindingSchema).max(500),
  metrics: z.object({
    totalTimeMs: z.number().nonnegative(),
    editCount: z.number().int().nonnegative(),
    averageTypingSpeedCPM: z.number().nonnegative(),
    thinkPauseRatio: z.number().min(0).max(100),
    copyPasteCount: z.number().int().nonnegative(),
  }).optional(),
});

router.post(
  "/v2/evidence/batches",
  authenticateExpressRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
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

      const result = await AuthorshipEvidenceService.recordEvidenceBatch(batch);

      return res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to record authorship evidence batch",
      });
    }
  }
);

router.post(
  "/v2/projects/:projectId/writing-sessions",
  authenticateExpressRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      const { projectId } = req.params;
      const parsedProjectId = z.string().uuid().safeParse(projectId);
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

      const result = await AuthorshipEvidenceService.recordWritingSessionSnapshot({
        ...snapshot,
        userId,
      });

      return res.status(201).json({
        success: true,
        data: result,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to save writing session snapshot",
      });
    }
  }
);

router.get(
  "/v2/projects/:projectId/report",
  authenticateExpressRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      const { projectId } = req.params;
      const parsedProjectId = z.string().uuid().safeParse(projectId);
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

      const report = await AuthorshipConfidenceService.generateProjectReport(
        parsedProjectId.data,
        userId
      );

      return res.status(200).json({
        success: true,
        data: report,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to generate authorship confidence report",
      });
    }
  }
);

router.get(
  "/v2/projects/:projectId/contributions",
  authenticateExpressRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      const { projectId } = req.params;
      const parsedProjectId = z.string().uuid().safeParse(projectId);
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

      const contributions: AuthorshipContributionDetail[] =
        await AuthorshipEvidenceService.getProjectContributions(parsedProjectId.data);

      return res.status(200).json({
        success: true,
        data: contributions,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to load authorship contributions",
      });
    }
  }
);

router.post(
  "/v2/projects/:projectId/reports",
  authenticateExpressRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      const { projectId } = req.params;
      const parsedProjectId = z.string().uuid().safeParse(projectId);
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

      const report = await AuthorshipConfidenceService.generateProjectReport(
        parsedProjectId.data,
        userId
      );

      return res.status(201).json({
        success: true,
        data: report,
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to generate authorship confidence report",
      });
    }
  }
);

router.post(
  "/v2/anomalies",
  authenticateExpressRequest,
  async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req as AuthenticatedRequest);
      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      const anomalySchema = z.object({
        projectId: z.string().uuid(),
        userId: z.string().uuid().optional(),
        evidenceId: z.string().optional(),
        anomalyType: z.string().max(120),
        severity: z.enum(["low", "medium", "high", "critical"]),
        score: z.number().nonnegative().max(100),
        message: z.string().max(500),
        metadata: z.record(z.string(), z.unknown()).optional(),
        detectedAt: z.string().datetime().optional(),
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

      const anomalyId = await AuthorshipEvidenceService.recordAnomaly({
        ...parsed.data,
        userId,
      });

      return res.status(201).json({
        success: true,
        data: { anomalyId },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to record authorship anomaly",
      });
    }
  }
);

export default router;
