import logger from "../../monitoring/logger";
import type { CanonicalDocument } from "../cdm";
import type { GenResult } from "../types";
import type { PpeSettings } from "../ppe/types";
import type { ExportJobStore } from "./store";
import type { ArtifactStore } from "./artifactStore";
import type { CdmResolver } from "./cdmResolver";
import type {
  ExportJobProgressEvent,
  ExportJobRecord,
} from "./types";
import type {
  Destination,
  DestinationAdapter,
  DestinationRegistry,
} from "../destinations";

/** Minimal engine surface the processor needs (decouples from the singleton). */
export interface PublishingEngineLike {
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
}

/** In-memory progress bus (consumed by SSE in the router). */
export interface JobEventBus {
  emit(event: ExportJobProgressEvent): void;
  subscribe(jobId: string, listener: (e: ExportJobProgressEvent) => void): () => void;
}

export interface ExportJobProcessorDeps {
  store: ExportJobStore;
  artifactStore: ArtifactStore;
  resolver: CdmResolver;
  engine: PublishingEngineLike;
  bus: JobEventBus;
  confirmBilling: (eventId: string) => Promise<void>;
  releaseBilling: (eventId: string, reason?: string) => Promise<void>;
  /** Phase 5: optional destination delivery after the artifact is stored. */
  destinationRegistry?: DestinationRegistry;
}

const EXT_BY_FORMAT: Record<string, string> = {
  pdf: "pdf",
  docx: "docx",
  latex: "tex",
  html: "html",
  rtf: "rtf",
  md: "md",
  epub: "epub",
  txt: "txt",
  submission: "zip",
};

export class ExportJobProcessor {
  constructor(private readonly deps: ExportJobProcessorDeps) {}

  /**
   * Execute a single job end-to-end. Idempotent and safe to (re)invoke:
   * terminal jobs short-circuit; a CANCELLED job is respectfully abandoned.
   *
   * Billing lifecycle: the hold is acquired at enqueue time. On success we
   * CONFIRM (charge); on final failure / cancellation we RELEASE (refund).
   * Retries keep the original hold open.
   */
  async process(jobId: string): Promise<ExportJobRecord> {
    const job = await this.deps.store.get(jobId);
    if (!job) throw new Error(`ExportJob ${jobId} not found`);
    if (job.status === "CANCELLED") return job;
    if (job.status === "SUCCEEDED" || job.status === "FAILED") return job;

    // This execution is an attempt. The processor owns the counter so retry
    // accounting is correct regardless of who invoked it (worker poll, inline
    // fast path, or a direct retry in tests).
    await this.deps.store.incrementAttempt(jobId);

    try {
      await this.deps.store.setStatus(jobId, "RUNNING");
      await this.emit(job, 5, "Resolving document");

      if (!job.docVersionId) {
        throw new Error(
          `Export job ${job.id} has no document version to resolve`,
        );
      }
      const cdm = await this.deps.resolver.resolve(job.docVersionId);

      await this.emit(job, 30, `Generating ${job.format}`);

      const result = await this.deps.engine.generate(cdm, {
        format: job.format,
        cslStyle: job.settings.cslStyle,
        templateId: job.settings.templateId,
        enableCiteproc: job.settings.enableCiteproc,
        ppe: job.settings.ppe,
      });
      await this.emit(job, 85, "Storing artifact");

      const ext =
        EXT_BY_FORMAT[result.format] ?? EXT_BY_FORMAT[job.format] ?? "bin";
      const fileName = `document.${ext}`;
      const { path, url } = await this.deps.artifactStore.put({
        userId: job.userId,
        jobId,
        fileName,
        buffer: result.buffer,
        mimeType: result.mimeType,
      });

      await this.deps.store.setArtifact(jobId, {
        path,
        url,
        mimeType: result.mimeType,
        size: result.sizeBytes,
        checksum: result.checksum,
      });
      const completed = await this.deps.store.markCompleted(jobId);
      await this.emit(completed, 100, "Complete");

      // Phase 5: deliver to a destination if one was requested. The artifact
      // bytes are still in scope, so we push without re-reading storage.
      if (job.settings.destination && this.deps.destinationRegistry) {
        await this.pushToDestination(job, fileName, result, url);
      }

      if (job.billingEventId) {
        await this.deps.confirmBilling(job.billingEventId);
      }
      return completed;
    } catch (err: any) {
      return this.handleFailure(job, err);
    }
  }

  private async handleFailure(
    job: ExportJobRecord,
    err: Error,
  ): Promise<ExportJobRecord> {
    const message = err?.message ?? "Unknown error";
    await this.deps.store.setError(job.id, message);

    const refreshed = await this.deps.store.get(job.id);
    const attempts = refreshed?.attempts ?? job.attempts;
    const max = refreshed?.maxAttempts ?? job.maxAttempts;

    if (attempts < max) {
      // Retryable: keep the billing hold, re-queue for the worker.
      const retrying = await this.deps.store.setStatus(job.id, "RETRYING");
      await this.emit(retrying, retrying.progress, `Retrying: ${message}`);
      logger.warn("Export job failed, will retry", {
        jobId: job.id,
        attempt: attempts,
        max,
        error: message,
      });
      return retrying;
    }

    // Exhausted: mark failed and refund the billing hold.
    const failed = await this.deps.store.setStatus(job.id, "FAILED");
    await this.emit(failed, failed.progress, `Failed: ${message}`);
    if (job.billingEventId) {
      await this.deps.releaseBilling(job.billingEventId, message).catch(() => {});
    }
    logger.error("Export job failed permanently", { jobId: job.id, error: message });
    return failed;
  }

  private async pushToDestination(
    job: ExportJobRecord,
    fileName: string,
    result: GenResult,
    artifactUrl: string,
  ): Promise<void> {
    const destination = job.settings.destination as Destination;
    const adapter: DestinationAdapter | undefined =
      this.deps.destinationRegistry?.get(destination);
    if (!adapter) {
      logger.warn("Export job requested unknown destination; skipping push", {
        jobId: job.id,
        destination,
      });
      return;
    }
    try {
      await this.emit(job, 95, `Delivering to ${destination}`);
      const pushResult = await adapter.push({
        userId: job.userId,
        jobId: job.id,
        fileName,
        mimeType: result.mimeType,
        getBytes: async () => result.buffer,
        artifactUrl,
      });
      if (!pushResult.ok) {
        logger.error("Destination push failed", {
          jobId: job.id,
          destination,
          message: pushResult.message,
        });
      }
    } catch (pushErr: any) {
      // A destination push failure must NOT fail the export itself — the
      // artifact is already stored and downloadable; surface and move on.
      logger.error("Destination push threw", {
        jobId: job.id,
        destination,
        error: pushErr?.message,
      });
    }
  }

  private async emit(
    job: ExportJobRecord,
    progress: number,
    message: string,
  ): Promise<void> {
    await this.deps.store.setProgress(job.id, progress, message).catch(() => {});
    this.deps.bus.emit({
      jobId: job.id,
      status: job.status,
      progress,
      message,
      at: new Date().toISOString(),
    });
  }
}
