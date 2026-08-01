"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportJobProcessor = void 0;
const logger_1 = __importDefault(require("../../monitoring/logger"));
const EXT_BY_FORMAT = {
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
class ExportJobProcessor {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    /**
     * Execute a single job end-to-end. Idempotent and safe to (re)invoke:
     * terminal jobs short-circuit; a CANCELLED job is respectfully abandoned.
     *
     * Billing lifecycle: the hold is acquired at enqueue time. On success we
     * CONFIRM (charge); on final failure / cancellation we RELEASE (refund).
     * Retries keep the original hold open.
     */
    async process(jobId) {
        const job = await this.deps.store.get(jobId);
        if (!job)
            throw new Error(`ExportJob ${jobId} not found`);
        if (job.status === "CANCELLED")
            return job;
        if (job.status === "SUCCEEDED" || job.status === "FAILED")
            return job;
        // This execution is an attempt. The processor owns the counter so retry
        // accounting is correct regardless of who invoked it (worker poll, inline
        // fast path, or a direct retry in tests).
        await this.deps.store.incrementAttempt(jobId);
        try {
            await this.deps.store.setStatus(jobId, "RUNNING");
            await this.emit(job, 5, "Resolving document");
            if (!job.docVersionId) {
                throw new Error(`Export job ${job.id} has no document version to resolve`);
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
            const ext = EXT_BY_FORMAT[result.format] ?? EXT_BY_FORMAT[job.format] ?? "bin";
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
        }
        catch (err) {
            return this.handleFailure(job, err);
        }
    }
    async handleFailure(job, err) {
        const message = err?.message ?? "Unknown error";
        await this.deps.store.setError(job.id, message);
        const refreshed = await this.deps.store.get(job.id);
        const attempts = refreshed?.attempts ?? job.attempts;
        const max = refreshed?.maxAttempts ?? job.maxAttempts;
        if (attempts < max) {
            // Retryable: keep the billing hold, re-queue for the worker.
            const retrying = await this.deps.store.setStatus(job.id, "RETRYING");
            await this.emit(retrying, retrying.progress, `Retrying: ${message}`);
            logger_1.default.warn("Export job failed, will retry", {
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
            await this.deps.releaseBilling(job.billingEventId, message).catch(() => { });
        }
        logger_1.default.error("Export job failed permanently", { jobId: job.id, error: message });
        return failed;
    }
    async pushToDestination(job, fileName, result, artifactUrl) {
        const destination = job.settings.destination;
        const adapter = this.deps.destinationRegistry?.get(destination);
        if (!adapter) {
            logger_1.default.warn("Export job requested unknown destination; skipping push", {
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
                logger_1.default.error("Destination push failed", {
                    jobId: job.id,
                    destination,
                    message: pushResult.message,
                });
            }
        }
        catch (pushErr) {
            // A destination push failure must NOT fail the export itself — the
            // artifact is already stored and downloadable; surface and move on.
            logger_1.default.error("Destination push threw", {
                jobId: job.id,
                destination,
                error: pushErr?.message,
            });
        }
    }
    async emit(job, progress, message) {
        await this.deps.store.setProgress(job.id, progress, message).catch(() => { });
        this.deps.bus.emit({
            jobId: job.id,
            status: job.status,
            progress,
            message,
            at: new Date().toISOString(),
        });
    }
}
exports.ExportJobProcessor = ExportJobProcessor;
