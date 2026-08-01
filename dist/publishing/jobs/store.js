"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryExportJobStore = exports.PrismaExportJobStore = void 0;
exports.createExportJobStore = createExportJobStore;
const prisma_1 = require("../../lib/prisma");
const types_1 = require("./types");
// ───────────────────────────── Prisma impl ─────────────────────────────
function rowToRecord(row) {
    return {
        id: row.id,
        userId: row.userId,
        projectId: row.projectId ?? null,
        docVersionId: row.docVersionId,
        format: (0, types_1.normalizeFormat)(row.format),
        status: row.status,
        attempts: row.attempts,
        maxAttempts: row.maxAttempts,
        progress: row.progress,
        statusMessage: row.statusMessage ?? null,
        settings: row.settings ?? {},
        artifactPath: row.artifactPath ?? null,
        artifactUrl: row.artifactUrl ?? null,
        artifactMimeType: row.artifactMimeType ?? null,
        artifactSize: row.artifactSize ?? null,
        artifactChecksum: row.artifactChecksum ?? null,
        billingEventId: row.billingEventId ?? null,
        error: row.error ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        startedAt: row.startedAt ?? null,
        completedAt: row.completedAt ?? null,
    };
}
class PrismaExportJobStore {
    async create(input) {
        const row = await prisma_1.prisma.exportJob.create({
            data: {
                id: input.id,
                userId: input.userId,
                projectId: input.projectId,
                docVersionId: input.docVersionId,
                format: (0, types_1.normalizeFormat)(input.format),
                settings: (input.settings ?? {}),
                billingEventId: input.billingEventId,
                status: "QUEUED",
            },
        });
        return rowToRecord(row);
    }
    async get(jobId) {
        const row = await prisma_1.prisma.exportJob.findUnique({ where: { id: jobId } });
        return row ? rowToRecord(row) : null;
    }
    async getByUser(userId, limit = 20) {
        const rows = await prisma_1.prisma.exportJob.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            take: limit,
        });
        return rows.map(rowToRecord);
    }
    async claimNext() {
        // Atomic claim: pick the oldest QUEUED/RETRYING job and flip it to RUNNING.
        const claimed = await prisma_1.prisma.$transaction(async (tx) => {
            const candidate = await tx.exportJob.findFirst({
                where: { status: { in: ["QUEUED", "RETRYING"] } },
                orderBy: { createdAt: "asc" },
            });
            if (!candidate)
                return null;
            const updated = await tx.exportJob.update({
                where: { id: candidate.id },
                data: {
                    status: "RUNNING",
                    startedAt: candidate.startedAt ?? new Date(),
                },
            });
            return updated;
        });
        return claimed ? rowToRecord(claimed) : null;
    }
    async setStatus(jobId, status) {
        const row = await prisma_1.prisma.exportJob.update({
            where: { id: jobId },
            data: { status },
        });
        return rowToRecord(row);
    }
    async setProgress(jobId, progress, message) {
        const row = await prisma_1.prisma.exportJob.update({
            where: { id: jobId },
            data: { progress, statusMessage: message ?? undefined },
        });
        return rowToRecord(row);
    }
    async incrementAttempt(jobId) {
        const row = await prisma_1.prisma.exportJob.update({
            where: { id: jobId },
            data: { attempts: { increment: 1 } },
        });
        return rowToRecord(row);
    }
    async setArtifact(jobId, artifact) {
        const row = await prisma_1.prisma.exportJob.update({
            where: { id: jobId },
            data: {
                artifactPath: artifact.path,
                artifactUrl: artifact.url,
                artifactMimeType: artifact.mimeType,
                artifactSize: artifact.size,
                artifactChecksum: artifact.checksum,
            },
        });
        return rowToRecord(row);
    }
    async setError(jobId, error) {
        const row = await prisma_1.prisma.exportJob.update({
            where: { id: jobId },
            data: { error },
        });
        return rowToRecord(row);
    }
    async markCompleted(jobId) {
        const updated = await prisma_1.prisma.exportJob.update({
            where: { id: jobId },
            data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
        });
        return rowToRecord(updated);
    }
}
exports.PrismaExportJobStore = PrismaExportJobStore;
// ─────────────────────────── In-memory impl (tests) ───────────────────────────
class InMemoryExportJobStore {
    jobs = new Map();
    async create(input) {
        const now = new Date();
        const record = {
            id: input.id,
            userId: input.userId,
            projectId: input.projectId,
            docVersionId: input.docVersionId,
            format: (0, types_1.normalizeFormat)(input.format),
            status: "QUEUED",
            attempts: 0,
            maxAttempts: 3,
            progress: 0,
            statusMessage: null,
            settings: input.settings ?? {},
            artifactPath: null,
            artifactUrl: null,
            artifactMimeType: null,
            artifactSize: null,
            artifactChecksum: null,
            billingEventId: input.billingEventId,
            error: null,
            createdAt: now,
            updatedAt: now,
            startedAt: null,
            completedAt: null,
        };
        this.jobs.set(record.id, record);
        return record;
    }
    async get(jobId) {
        return this.jobs.get(jobId) ?? null;
    }
    async getByUser(userId, limit = 20) {
        return [...this.jobs.values()]
            .filter((j) => j.userId === userId)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .slice(0, limit);
    }
    async claimNext() {
        const candidate = [...this.jobs.values()]
            .filter((j) => j.status === "QUEUED" || j.status === "RETRYING")
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
        if (!candidate)
            return null;
        candidate.status = "RUNNING";
        if (!candidate.startedAt)
            candidate.startedAt = new Date();
        return candidate;
    }
    async setStatus(jobId, status) {
        const j = this.must(jobId);
        j.status = status;
        j.updatedAt = new Date();
        return j;
    }
    async setProgress(jobId, progress, message) {
        const j = this.must(jobId);
        j.progress = progress;
        j.statusMessage = message ?? j.statusMessage;
        j.updatedAt = new Date();
        return j;
    }
    async incrementAttempt(jobId) {
        const j = this.must(jobId);
        j.attempts += 1;
        j.updatedAt = new Date();
        return j;
    }
    async setArtifact(jobId, artifact) {
        const j = this.must(jobId);
        j.artifactPath = artifact.path;
        j.artifactUrl = artifact.url;
        j.artifactMimeType = artifact.mimeType;
        j.artifactSize = artifact.size;
        j.artifactChecksum = artifact.checksum;
        j.updatedAt = new Date();
        return j;
    }
    async setError(jobId, error) {
        const j = this.must(jobId);
        j.error = error;
        j.updatedAt = new Date();
        return j;
    }
    async markCompleted(jobId) {
        const j = this.must(jobId);
        j.status = "SUCCEEDED";
        j.progress = 100;
        j.completedAt = new Date();
        j.updatedAt = new Date();
        return j;
    }
    must(jobId) {
        const j = this.jobs.get(jobId);
        if (!j)
            throw new Error(`ExportJob ${jobId} not found`);
        return j;
    }
}
exports.InMemoryExportJobStore = InMemoryExportJobStore;
function createExportJobStore() {
    return new PrismaExportJobStore();
}
