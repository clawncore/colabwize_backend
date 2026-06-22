import type { AuditJob, AuditReport } from "./types";
import type { VerificationResult } from "../types/citationAudit";

interface VerificationEvidenceInput {
    audit_job_id: string;
    reference_index: number | null;
    inline_start: number | null;
    inline_end: number | null;
    inline_text: string | null;
    status: string;
    message: string;
    evidence_json: unknown;
}

interface ScoreSnapshotInput {
    audit_job_id: string;
    integrity_index: number;
    compliance_score: number;
    score_breakdown: unknown;
    summary: unknown;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prismaClient: any = null;

const isPersistenceEnabled = (): boolean => process.env.AUDIT_PERSISTENCE_ENABLED !== "false";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPrismaClient(): any {
    if (!prismaClient) {
        // Dynamic require so the module loads even if Prisma client hasn't been generated yet.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { PrismaClient } = require("@prisma/client");
        prismaClient = new PrismaClient({ log: ["error"] });
    }

    return prismaClient;
}

function getVerificationEvidence(job: AuditJob): VerificationEvidenceInput[] {
    const results = Array.isArray(job.report?.verificationResults)
        ? (job.report.verificationResults as VerificationResult[])
        : [];

    return results.map((result) => {
        const inlineStart = typeof result.inlineLocation?.start === "number" ? result.inlineLocation.start : null;
        const inlineEnd = typeof result.inlineLocation?.end === "number" ? result.inlineLocation.end : null;

        return {
            audit_job_id: job.auditId,
            reference_index: typeof result.referenceIndex === "number" ? result.referenceIndex : null,
            inline_start: inlineStart,
            inline_end: inlineEnd,
            inline_text: result.inlineLocation?.text ?? null,
            status: result.status,
            message: result.message,
            evidence_json: result,
        };
    });
}

function getScoreSnapshot(job: AuditJob): ScoreSnapshotInput | null {
    const report = job.report;
    if (!report) return null;

    return {
        audit_job_id: job.auditId,
        integrity_index: report.integrityIndex ?? report.summary.complianceScore,
        compliance_score: report.summary.complianceScore,
        score_breakdown: report.scoreBreakdown ?? null,
        summary: report.summary,
    };
}

async function persistJobReport(job: AuditJob, report: AuditReport) {
    const client = getPrismaClient();
    if (!client.auditReport) return;

    const verificationEvidence = getVerificationEvidence(job);
    const scoreSnapshot = getScoreSnapshot(job);

    await client.auditReport.upsert({
        where: { audit_job_id: job.auditId },
        create: {
            audit_job_id: job.auditId,
            report_json: report,
        },
        update: {
            report_json: report,
        },
    });

    await client.verificationEvidence.deleteMany({ where: { audit_job_id: job.auditId } });
    if (verificationEvidence.length > 0) {
        await client.verificationEvidence.createMany({ data: verificationEvidence });
    }

    if (scoreSnapshot) {
        await client.integrityScoreSnapshot.create({
            data: scoreSnapshot,
        });
    }
}

export async function persistAuditJob(job: AuditJob): Promise<void> {
    if (!isPersistenceEnabled()) return;

    const client = getPrismaClient();
    if (!client.auditJob) {
        console.error("[AuditPersistence] auditJob model not available on Prisma client — skipping persist");
        return;
    }
    await client.auditJob.upsert({
        where: { id: job.auditId },
        create: {
            id: job.auditId,
            user_id: job.userId || null,
            project_id: job.projectId || null,
            document_id: job.documentId || null,
            status: job.status,
            current_stage: job.currentStage,
            progress: job.progress,
            started_at: new Date(job.startedAt),
            completed_at: job.completedAt ? new Date(job.completedAt) : null,
            error: job.error || null,
            report: job.report ?? null,
        },
        update: {
            status: job.status,
            current_stage: job.currentStage,
            progress: job.progress,
            completed_at: job.completedAt ? new Date(job.completedAt) : null,
            error: job.error || null,
            report: job.report ?? null,
        },
    });

    if (job.report) {
        await persistJobReport(job, job.report);
    }
}

export function persistAuditJobInBackground(job: AuditJob) {
    persistAuditJob(job).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown persistence error";
        console.error(`[AuditPersistence] Failed to persist job ${job.auditId}:`, message);
    });
}

/**
 * Lightweight status-only persistence for intermediate pipeline stages.
 * Only writes status/progress/stage — NOT the full report JSON.
 * This reduces DB write volume by ~80% during audit execution.
 * Full report persistence only happens on completion/failure via persistAuditJobInBackground.
 */
export function persistAuditJobStatusInBackground(job: AuditJob) {
    if (!isPersistenceEnabled()) return;

    const client = getPrismaClient();
    if (!client.auditJob) {
        return; // Persistence not available (e.g. Prisma client not regenerated)
    }
    client.auditJob.upsert({
        where: { id: job.auditId },
        create: {
            id: job.auditId,
            user_id: job.userId || null,
            project_id: job.projectId || null,
            document_id: job.documentId || null,
            status: job.status,
            current_stage: job.currentStage,
            progress: job.progress,
            started_at: new Date(job.startedAt),
            completed_at: job.completedAt ? new Date(job.completedAt) : null,
            error: job.error || null,
            // No report field on create for intermediate stages
        },
        update: {
            status: job.status,
            current_stage: job.currentStage,
            progress: job.progress,
            completed_at: job.completedAt ? new Date(job.completedAt) : null,
            error: job.error || null,
            // No report field on update for intermediate stages
        },
    }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Unknown persistence error";
        console.error(`[AuditPersistence] Failed to persist job status ${job.auditId}:`, message);
    });
}
