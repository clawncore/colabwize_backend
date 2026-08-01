"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportJobWorker = exports.JobEventBus = void 0;
const events_1 = require("events");
const logger_1 = __importDefault(require("../../monitoring/logger"));
/**
 * JobEventBus — fan-out of progress events to SSE subscribers.
 *
 * In-process only for Phase 3. A multi-instance deployment would back this
 * with Redis pub/sub (or the same PG NOTIFY channel the queue uses) so any
 * instance can stream a job's progress to its connected client. The interface
 * is intentionally tiny to make that swap trivial.
 */
class JobEventBus {
    emitter = new events_1.EventEmitter();
    static KEY = (jobId) => `job:${jobId}`;
    constructor() {
        // Many concurrent job subscriptions; lift the default warning ceiling.
        this.emitter.setMaxListeners(100);
    }
    emit(event) {
        this.emitter.emit(JobEventBus.KEY(event.jobId), event);
    }
    subscribe(jobId, listener) {
        const key = JobEventBus.KEY(jobId);
        this.emitter.on(key, listener);
        return () => this.emitter.off(key, listener);
    }
}
exports.JobEventBus = JobEventBus;
/**
 * ExportJobWorker — pulls runnable jobs from the store and processes them.
 *
 * The store's `claimNext()` is the queue substrate (PG-backed in prod, in
 * memory for tests). A worker is stateless and can run in *any* process —
 * including a dedicated container (the Phase 3 "containerized worker pool"
 * target). `start()` begins a polling loop; `process(jobId)` runs one job
 * inline (used by the adaptive sync-fast path and by tests).
 */
class ExportJobWorker {
    store;
    processor;
    running = false;
    timer = null;
    pollMs;
    constructor(store, processor, opts = {}) {
        this.store = store;
        this.processor = processor;
        this.pollMs = opts.pollMs ?? 1000;
    }
    /** Run a single job now (the sync-fast adaptive path). */
    async runJob(jobId) {
        try {
            await this.processor.process(jobId);
        }
        catch (e) {
            logger_1.default.error("Worker failed to process job", { jobId, error: e.message });
        }
    }
    /** Begin polling the queue. Safe to call once; no-op if already running. */
    start() {
        if (this.running)
            return;
        this.running = true;
        logger_1.default.info("ExportJobWorker started", { pollMs: this.pollMs });
        this.timer = setInterval(() => void this.tick(), this.pollMs);
        // Don't keep the event loop alive solely for the poller.
        if (typeof this.timer.unref === "function")
            this.timer.unref();
    }
    stop() {
        if (this.timer)
            clearInterval(this.timer);
        this.timer = null;
        this.running = false;
        logger_1.default.info("ExportJobWorker stopped");
    }
    async tick() {
        try {
            const job = await this.store.claimNext();
            if (!job)
                return;
            await this.runJob(job.id);
        }
        catch (e) {
            logger_1.default.error("ExportJobWorker tick error", { error: e.message });
        }
    }
}
exports.ExportJobWorker = ExportJobWorker;
