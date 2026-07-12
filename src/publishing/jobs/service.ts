import { randomUUID } from "crypto";
import { BillingGateway, BillingError } from "../../billing/BillingGateway";
import { cdmToPlainText } from "../serializers/text";
import logger from "../../monitoring/logger";
import type { CanonicalDocument } from "../cdm";
import type { GenResult, AdapterComplexity } from "../types";
import type { PpeSettings } from "../ppe/types";
import type { ExportJobStore } from "./store";
import type { ArtifactStore } from "./artifactStore";
import type { CdmResolver } from "./cdmResolver";
import type { ExportJobProcessor } from "./processor";
import type { JobEventBus, ExportJobWorker } from "./queue";
import type { TemplateResolver } from "../templates/engine";
import { templateToExportSettings } from "../templates/types";
import type {
  CreateExportJobInput,
  ExportJobEnqueued,
  ExportJobProgressEvent,
  ExportJobRecord,
  ExportJobSettings,
} from "./types";

/** Engine surface the service needs (generation + complexity estimate). */
export interface ExportEngineLike {
  generate(
    doc: CanonicalDocument,
    opts: {
      format: string;
      cslStyle?: string;
      templateId?: string;
      enableCiteproc?: boolean;
      ppe?: PpeSettings;
    },
  ): Promise<GenResult>;
  getAdapter(
    format: string,
  ): { estimateComplexity(doc: CanonicalDocument): AdapterComplexity } | null;
}

/** Billing boundary kept injectable for tests. */
export interface BillingClient {
  hold(
    userId: string,
    referenceId: string,
    wordCount: number,
  ): Promise<{ eventId: string }>;
  confirm(eventId: string): Promise<void>;
  release(eventId: string, reason?: string): Promise<void>;
}

export class BillingGatewayClient implements BillingClient {
  async hold(
    userId: string,
    referenceId: string,
    wordCount: number,
  ): Promise<{ eventId: string }> {
    const hold = await BillingGateway.hold(userId, "publish_export", {
      referenceId,
      wordCount,
    });
    return { eventId: hold.eventId };
  }
  confirm(eventId: string): Promise<void> {
    return BillingGateway.confirm(eventId);
  }
  release(eventId: string, reason?: string): Promise<void> {
    return BillingGateway.release(eventId, reason);
  }
}

export class ExportBillingError extends Error {
  constructor(
    public code: string,
    message: string,
    public data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ExportBillingError";
  }
}

export interface ExportJobServiceDeps {
  store: ExportJobStore;
  resolver: CdmResolver;
  engine: ExportEngineLike;
  bus: JobEventBus;
  worker: ExportJobWorker;
  billing?: BillingClient;
  idGenerator?: () => string;
  /** Optional: when a job requests a templateId, resolve & merge its settings. */
  templateResolver?: TemplateResolver;
}

export class ExportJobService {
  private readonly billing: BillingClient;
  private readonly idGenerator: () => string;

  constructor(private readonly deps: ExportJobServiceDeps) {
    this.billing = deps.billing ?? new BillingGatewayClient();
    this.idGenerator = deps.idGenerator ?? randomUUID;
  }

  /**
   * Enqueue (or, for cheap formats, run synchronously) an export job.
   *
   * 1. Resolve CDM to compute word count + complexity.
   * 2. Acquire a billing hold (idempotent via jobId referenceId).
   * 3. Persist the job row.
   * 4. Fast path → process inline and return the artifact. Slow path → return
   *    the jobId for the client to poll / stream.
   */
  async createExportJob(
    input: CreateExportJobInput,
  ): Promise<ExportJobEnqueued> {
    if (!input.cdm && !input.docVersionId) {
      throw new Error(
        "createExportJob requires either `cdm` or `docVersionId`",
      );
    }
    const cdm =
      input.cdm ??
      (await this.deps.resolver.resolve(input.docVersionId as string));
    const wordCount = estimateWordCount(cdm);

    const jobId = this.idGenerator();
    let settings: ExportJobSettings = input.settings ?? {};

    // Phase 4: if a template was requested, resolve it and merge the settings
    // it implies (CSL style + citeproc). Explicit settings win over the
    // template's defaults when both are present.
    if (settings.templateId && this.deps.templateResolver) {
      const tpl = await this.deps.templateResolver.resolve(settings.templateId);
      const merged = templateToExportSettings(tpl);
      settings = {
        ...settings,
        cslStyle: settings.cslStyle ?? merged.cslStyle,
        enableCiteproc: settings.enableCiteproc ?? merged.enableCiteproc,
      };
    }

    const hold = await this.billing
      .hold(input.userId, jobId, wordCount)
      .catch((e: unknown) => {
        if (e instanceof BillingError) {
          throw new ExportBillingError(e.code, e.message, e.data);
        }
        throw e;
      });

    const record = await this.deps.store.create({
      id: jobId,
      userId: input.userId,
      projectId: input.projectId ?? null,
      docVersionId: input.docVersionId ?? null,
      format: input.format,
      settings,
      billingEventId: hold.eventId,
    });

    const complexity = this.estimateComplexity(cdm, input.format);

    if (complexity === "fast") {
      const completed = await this.deps.worker.runJob(jobId).then(() =>
        this.deps.store.get(jobId),
      );
      return toEnqueued(completed!);
    }

    return toEnqueued(record);
  }

  async getJob(userId: string, jobId: string): Promise<ExportJobRecord | null> {
    const job = await this.deps.store.get(jobId);
    if (!job || job.userId !== userId) return null;
    return job;
  }

  /** Phase 6 — History: list the caller's export jobs, newest first. */
  async listJobs(userId: string): Promise<ExportJobRecord[]> {
    return this.deps.store.getByUser(userId);
  }

  async cancelJob(userId: string, jobId: string): Promise<ExportJobRecord> {
    const job = await this.deps.store.get(jobId);
    if (!job || job.userId !== userId) {
      throw new Error("Export job not found");
    }
    if (job.status === "SUCCEEDED" || job.status === "FAILED") {
      return job; // already terminal; nothing to do
    }
    const cancelled = await this.deps.store.setStatus(jobId, "CANCELLED");
    if (job.billingEventId) {
      await this.billing.release(job.billingEventId, "cancelled").catch(() => {});
    }
    logger.info("Export job cancelled", { jobId, userId });
    return cancelled;
  }

  subscribe(
    jobId: string,
    listener: (e: ExportJobProgressEvent) => void,
  ): () => void {
    return this.deps.bus.subscribe(jobId, listener);
  }

  startWorker(): void {
    this.deps.worker.start();
  }

  stopWorker(): void {
    this.deps.worker.stop();
  }

  private estimateComplexity(
    cdm: CanonicalDocument,
    format: string,
  ): AdapterComplexity {
    const adapter = this.deps.engine.getAdapter(format);
    if (!adapter) return "slow";
    try {
      return adapter.estimateComplexity(cdm);
    } catch {
      return "slow";
    }
  }
}

function estimateWordCount(cdm: CanonicalDocument): number {
  const text = cdmToPlainText(cdm);
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function toEnqueued(job: ExportJobRecord): ExportJobEnqueued {
  const completed = job.status === "SUCCEEDED";
  return {
    jobId: job.id,
    completed,
    status: job.status,
    artifact: completed
      ? {
          path: job.artifactPath!,
          url: job.artifactUrl!,
          mimeType: job.artifactMimeType!,
          size: job.artifactSize!,
          checksum: job.artifactChecksum!,
        }
      : null,
  };
}
