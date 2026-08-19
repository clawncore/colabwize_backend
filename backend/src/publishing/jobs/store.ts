import { prisma } from "../../lib/prisma";
import type {
  ExportJobRecord,
  ExportJobSettings,
  ExportJobStatus,
} from "./types";
import { normalizeFormat } from "./types";

/**
 * ExportJobStore — persistence boundary for export jobs.
 *
 * The production implementation is Prisma-backed. Tests inject an in-memory
 * implementation so the job lifecycle can be exercised without a database.
 * All methods are async to mirror the production contract.
 */
export interface ExportJobStore {
  create(input: {
    id: string;
    userId: string;
    projectId: string | null;
    docVersionId: string | null;
    format: string;
    settings: ExportJobSettings;
    billingEventId: string;
  }): Promise<ExportJobRecord>;

  get(jobId: string): Promise<ExportJobRecord | null>;
  getByUser(userId: string, limit?: number): Promise<ExportJobRecord[]>;

  /** Claim the next runnable job (for a worker). Returns null if none ready. */
  claimNext(): Promise<ExportJobRecord | null>;

  setStatus(jobId: string, status: ExportJobStatus): Promise<ExportJobRecord>;
  setProgress(
    jobId: string,
    progress: number,
    message?: string | null,
  ): Promise<ExportJobRecord>;
  incrementAttempt(jobId: string): Promise<ExportJobRecord>;
  setArtifact(
    jobId: string,
    artifact: {
      path: string;
      url: string;
      mimeType: string;
      size: number;
      checksum: string;
    },
  ): Promise<ExportJobRecord>;
  setError(jobId: string, error: string): Promise<ExportJobRecord>;
  markCompleted(jobId: string): Promise<ExportJobRecord>;
}

// ───────────────────────────── Prisma impl ─────────────────────────────

function rowToRecord(row: any): ExportJobRecord {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId ?? null,
    docVersionId: row.docVersionId,
    format: normalizeFormat(row.format),
    status: row.status,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    progress: row.progress,
    statusMessage: row.statusMessage ?? null,
    settings: (row.settings as ExportJobSettings) ?? {},
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

export class PrismaExportJobStore implements ExportJobStore {
  async create(input: {
    id: string;
    userId: string;
    projectId: string | null;
    docVersionId: string | null;
    format: string;
    settings: ExportJobSettings;
    billingEventId: string;
  }): Promise<ExportJobRecord> {
    const row = await prisma.exportJob.create({
      data: {
        id: input.id,
        userId: input.userId,
        projectId: input.projectId,
        docVersionId: input.docVersionId,
        format: normalizeFormat(input.format),
        settings: (input.settings ?? {}) as any,
        billingEventId: input.billingEventId,
        status: "QUEUED",
      },
    });
    return rowToRecord(row);
  }

  async get(jobId: string): Promise<ExportJobRecord | null> {
    const row = await prisma.exportJob.findUnique({ where: { id: jobId } });
    return row ? rowToRecord(row) : null;
  }

  async getByUser(userId: string, limit = 20): Promise<ExportJobRecord[]> {
    const rows = await prisma.exportJob.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return rows.map(rowToRecord);
  }

  async claimNext(): Promise<ExportJobRecord | null> {
    // Atomic claim: pick the oldest QUEUED/RETRYING job and flip it to RUNNING.
    const claimed = await prisma.$transaction(async (tx: any) => {
      const candidate = await tx.exportJob.findFirst({
        where: { status: { in: ["QUEUED", "RETRYING"] } },
        orderBy: { createdAt: "asc" },
      });
      if (!candidate) return null;
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

  async setStatus(
    jobId: string,
    status: ExportJobStatus,
  ): Promise<ExportJobRecord> {
    const row = await prisma.exportJob.update({
      where: { id: jobId },
      data: { status },
    });
    return rowToRecord(row);
  }

  async setProgress(
    jobId: string,
    progress: number,
    message?: string | null,
  ): Promise<ExportJobRecord> {
    const row = await prisma.exportJob.update({
      where: { id: jobId },
      data: { progress, statusMessage: message ?? undefined },
    });
    return rowToRecord(row);
  }

  async incrementAttempt(jobId: string): Promise<ExportJobRecord> {
    const row = await prisma.exportJob.update({
      where: { id: jobId },
      data: { attempts: { increment: 1 } },
    });
    return rowToRecord(row);
  }

  async setArtifact(
    jobId: string,
    artifact: {
      path: string;
      url: string;
      mimeType: string;
      size: number;
      checksum: string;
    },
  ): Promise<ExportJobRecord> {
    const row = await prisma.exportJob.update({
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

  async setError(jobId: string, error: string): Promise<ExportJobRecord> {
    const row = await prisma.exportJob.update({
      where: { id: jobId },
      data: { error },
    });
    return rowToRecord(row);
  }

  async markCompleted(jobId: string): Promise<ExportJobRecord> {
    const updated = await prisma.exportJob.update({
      where: { id: jobId },
      data: { status: "SUCCEEDED", progress: 100, completedAt: new Date() },
    });
    return rowToRecord(updated);
  }
}

// ─────────────────────────── In-memory impl (tests) ───────────────────────────

export class InMemoryExportJobStore implements ExportJobStore {
  private jobs = new Map<string, ExportJobRecord>();

  async create(input: {
    id: string;
    userId: string;
    projectId: string | null;
    docVersionId: string | null;
    format: string;
    settings: ExportJobSettings;
    billingEventId: string;
  }): Promise<ExportJobRecord> {
    const now = new Date();
    const record: ExportJobRecord = {
      id: input.id,
      userId: input.userId,
      projectId: input.projectId,
      docVersionId: input.docVersionId,
      format: normalizeFormat(input.format),
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

  async get(jobId: string): Promise<ExportJobRecord | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async getByUser(userId: string, limit = 20): Promise<ExportJobRecord[]> {
    return [...this.jobs.values()]
      .filter((j) => j.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async claimNext(): Promise<ExportJobRecord | null> {
    const candidate = [...this.jobs.values()]
      .filter((j) => j.status === "QUEUED" || j.status === "RETRYING")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!candidate) return null;
    candidate.status = "RUNNING";
    if (!candidate.startedAt) candidate.startedAt = new Date();
    return candidate;
  }

  async setStatus(
    jobId: string,
    status: ExportJobStatus,
  ): Promise<ExportJobRecord> {
    const j = this.must(jobId);
    j.status = status;
    j.updatedAt = new Date();
    return j;
  }

  async setProgress(
    jobId: string,
    progress: number,
    message?: string | null,
  ): Promise<ExportJobRecord> {
    const j = this.must(jobId);
    j.progress = progress;
    j.statusMessage = message ?? j.statusMessage;
    j.updatedAt = new Date();
    return j;
  }

  async incrementAttempt(jobId: string): Promise<ExportJobRecord> {
    const j = this.must(jobId);
    j.attempts += 1;
    j.updatedAt = new Date();
    return j;
  }

  async setArtifact(
    jobId: string,
    artifact: {
      path: string;
      url: string;
      mimeType: string;
      size: number;
      checksum: string;
    },
  ): Promise<ExportJobRecord> {
    const j = this.must(jobId);
    j.artifactPath = artifact.path;
    j.artifactUrl = artifact.url;
    j.artifactMimeType = artifact.mimeType;
    j.artifactSize = artifact.size;
    j.artifactChecksum = artifact.checksum;
    j.updatedAt = new Date();
    return j;
  }

  async setError(jobId: string, error: string): Promise<ExportJobRecord> {
    const j = this.must(jobId);
    j.error = error;
    j.updatedAt = new Date();
    return j;
  }

  async markCompleted(jobId: string): Promise<ExportJobRecord> {
    const j = this.must(jobId);
    j.status = "SUCCEEDED";
    j.progress = 100;
    j.completedAt = new Date();
    j.updatedAt = new Date();
    return j;
  }

  private must(jobId: string): ExportJobRecord {
    const j = this.jobs.get(jobId);
    if (!j) throw new Error(`ExportJob ${jobId} not found`);
    return j;
  }
}

export function createExportJobStore(): ExportJobStore {
  return new PrismaExportJobStore();
}
