import { EventEmitter } from "events";
import logger from "../../monitoring/logger";
import type { ExportJobStore } from "./store";
import type { ExportJobProcessor } from "./processor";
import type { ExportJobProgressEvent } from "./types";

/**
 * JobEventBus — fan-out of progress events to SSE subscribers.
 *
 * In-process only for Phase 3. A multi-instance deployment would back this
 * with Redis pub/sub (or the same PG NOTIFY channel the queue uses) so any
 * instance can stream a job's progress to its connected client. The interface
 * is intentionally tiny to make that swap trivial.
 */
export class JobEventBus {
  private emitter = new EventEmitter();
  private static KEY = (jobId: string) => `job:${jobId}`;

  constructor() {
    // Many concurrent job subscriptions; lift the default warning ceiling.
    this.emitter.setMaxListeners(100);
  }

  emit(event: ExportJobProgressEvent): void {
    this.emitter.emit(JobEventBus.KEY(event.jobId), event);
  }

  subscribe(
    jobId: string,
    listener: (e: ExportJobProgressEvent) => void,
  ): () => void {
    const key = JobEventBus.KEY(jobId);
    this.emitter.on(key, listener);
    return () => this.emitter.off(key, listener);
  }
}

/**
 * ExportJobWorker — pulls runnable jobs from the store and processes them.
 *
 * The store's `claimNext()` is the queue substrate (PG-backed in prod, in
 * memory for tests). A worker is stateless and can run in *any* process —
 * including a dedicated container (the Phase 3 "containerized worker pool"
 * target). `start()` begins a polling loop; `process(jobId)` runs one job
 * inline (used by the adaptive sync-fast path and by tests).
 */
export class ExportJobWorker {
  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly pollMs: number;

  constructor(
    private readonly store: ExportJobStore,
    private readonly processor: ExportJobProcessor,
    opts: { pollMs?: number } = {},
  ) {
    this.pollMs = opts.pollMs ?? 1000;
  }

  /** Run a single job now (the sync-fast adaptive path). */
  async runJob(jobId: string): Promise<void> {
    try {
      await this.processor.process(jobId);
    } catch (e: any) {
      logger.error("Worker failed to process job", { jobId, error: e.message });
    }
  }

  /** Begin polling the queue. Safe to call once; no-op if already running. */
  start(): void {
    if (this.running) return;
    this.running = true;
    logger.info("ExportJobWorker started", { pollMs: this.pollMs });
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    // Don't keep the event loop alive solely for the poller.
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.running = false;
    logger.info("ExportJobWorker stopped");
  }

  private async tick(): Promise<void> {
    try {
      const job = await this.store.claimNext();
      if (!job) return;
      await this.runJob(job.id);
    } catch (e: any) {
      logger.error("ExportJobWorker tick error", { error: e.message });
    }
  }
}
