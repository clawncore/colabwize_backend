"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportJobService = exports.ExportBillingError = exports.BillingGatewayClient = void 0;
const crypto_1 = require("crypto");
const BillingGateway_1 = require("../../billing/BillingGateway");
const text_1 = require("../serializers/text");
const logger_1 = __importDefault(require("../../monitoring/logger"));
const types_1 = require("../templates/types");
class BillingGatewayClient {
    async hold(userId, referenceId, wordCount) {
        const hold = await BillingGateway_1.BillingGateway.hold(userId, "publish_export", {
            referenceId,
            wordCount,
        });
        return { eventId: hold.eventId };
    }
    confirm(eventId) {
        return BillingGateway_1.BillingGateway.confirm(eventId);
    }
    release(eventId, reason) {
        return BillingGateway_1.BillingGateway.release(eventId, reason);
    }
}
exports.BillingGatewayClient = BillingGatewayClient;
class ExportBillingError extends Error {
    code;
    data;
    constructor(code, message, data) {
        super(message);
        this.code = code;
        this.data = data;
        this.name = "ExportBillingError";
    }
}
exports.ExportBillingError = ExportBillingError;
class ExportJobService {
    deps;
    billing;
    idGenerator;
    constructor(deps) {
        this.deps = deps;
        this.billing = deps.billing ?? new BillingGatewayClient();
        this.idGenerator = deps.idGenerator ?? crypto_1.randomUUID;
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
    async createExportJob(input) {
        if (!input.cdm && !input.docVersionId) {
            throw new Error("createExportJob requires either `cdm` or `docVersionId`");
        }
        const cdm = input.cdm ??
            (await this.deps.resolver.resolve(input.docVersionId));
        const wordCount = estimateWordCount(cdm);
        const jobId = this.idGenerator();
        let settings = input.settings ?? {};
        // Phase 4: if a template was requested, resolve it and merge the settings
        // it implies (CSL style + citeproc). Explicit settings win over the
        // template's defaults when both are present.
        if (settings.templateId && this.deps.templateResolver) {
            const tpl = await this.deps.templateResolver.resolve(settings.templateId);
            const merged = (0, types_1.templateToExportSettings)(tpl);
            settings = {
                ...settings,
                cslStyle: settings.cslStyle ?? merged.cslStyle,
                enableCiteproc: settings.enableCiteproc ?? merged.enableCiteproc,
            };
        }
        const hold = await this.billing
            .hold(input.userId, jobId, wordCount)
            .catch((e) => {
            if (e instanceof BillingGateway_1.BillingError) {
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
            const completed = await this.deps.worker.runJob(jobId).then(() => this.deps.store.get(jobId));
            return toEnqueued(completed);
        }
        return toEnqueued(record);
    }
    async getJob(userId, jobId) {
        const job = await this.deps.store.get(jobId);
        if (!job || job.userId !== userId)
            return null;
        return job;
    }
    /** Phase 6 — History: list the caller's export jobs, newest first. */
    async listJobs(userId) {
        return this.deps.store.getByUser(userId);
    }
    async cancelJob(userId, jobId) {
        const job = await this.deps.store.get(jobId);
        if (!job || job.userId !== userId) {
            throw new Error("Export job not found");
        }
        if (job.status === "SUCCEEDED" || job.status === "FAILED") {
            return job; // already terminal; nothing to do
        }
        const cancelled = await this.deps.store.setStatus(jobId, "CANCELLED");
        if (job.billingEventId) {
            await this.billing.release(job.billingEventId, "cancelled").catch(() => { });
        }
        logger_1.default.info("Export job cancelled", { jobId, userId });
        return cancelled;
    }
    subscribe(jobId, listener) {
        return this.deps.bus.subscribe(jobId, listener);
    }
    startWorker() {
        this.deps.worker.start();
    }
    stopWorker() {
        this.deps.worker.stop();
    }
    estimateComplexity(cdm, format) {
        const adapter = this.deps.engine.getAdapter(format);
        if (!adapter)
            return "slow";
        try {
            return adapter.estimateComplexity(cdm);
        }
        catch {
            return "slow";
        }
    }
}
exports.ExportJobService = ExportJobService;
function estimateWordCount(cdm) {
    const text = (0, text_1.cdmToPlainText)(cdm);
    const trimmed = text.trim();
    if (!trimmed)
        return 0;
    return trimmed.split(/\s+/).length;
}
function toEnqueued(job) {
    const completed = job.status === "SUCCEEDED";
    return {
        jobId: job.id,
        completed,
        status: job.status,
        artifact: completed
            ? {
                path: job.artifactPath,
                url: job.artifactUrl,
                mimeType: job.artifactMimeType,
                size: job.artifactSize,
                checksum: job.artifactChecksum,
            }
            : null,
    };
}
