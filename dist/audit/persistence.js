"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.persistAuditJob = persistAuditJob;
exports.persistAuditJobInBackground = persistAuditJobInBackground;
exports.persistAuditJobStatusInBackground = persistAuditJobStatusInBackground;
const isPersistenceEnabled = () => process.env.AUDIT_PERSISTENCE_ENABLED !== "false";
/**
 * Get the shared Prisma client singleton from src/lib/prisma.
 * This ensures we always use the properly configured client (with adapter, etc.)
 * rather than creating a separate bare PrismaClient instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPrismaClient() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { prisma } = require("../lib/prisma");
    return prisma;
}
function getVerificationEvidence(job) {
    const results = Array.isArray(job.report?.verificationResults)
        ? job.report.verificationResults
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
function getScoreSnapshot(job) {
    const report = job.report;
    if (!report)
        return null;
    return {
        audit_job_id: job.auditId,
        integrity_index: report.integrityIndex ?? report.summary.complianceScore,
        compliance_score: report.summary.complianceScore,
        score_breakdown: report.scoreBreakdown ?? null,
        summary: report.summary,
    };
}
async function persistJobReport(job, report) {
    const client = getPrismaClient();
    if (!client.auditReport)
        return;
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
async function persistAuditJob(job) {
    if (!isPersistenceEnabled())
        return;
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
function persistAuditJobInBackground(job) {
    persistAuditJob(job).catch((error) => {
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
function persistAuditJobStatusInBackground(job) {
    if (!isPersistenceEnabled())
        return;
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
    }).catch((error) => {
        const message = error instanceof Error ? error.message : "Unknown persistence error";
        console.error(`[AuditPersistence] Failed to persist job status ${job.auditId}:`, message);
    });
}
