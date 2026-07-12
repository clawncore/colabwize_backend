import { v4 as uuidv4 } from "uuid";
import { AuditJob, AuditReport, AuditContext, AuditPipelineStage, ExtractedCitation, ExtractedReference } from "./types";

import { ALL_STAGES } from "./stages";
import { persistAuditJobInBackground, persistAuditJobStatusInBackground } from "./persistence";

// In-memory store for active/completed audit jobs.
// Persistence writes run in the background via persistence.ts, but this cache keeps the existing SSE flow fast.
const jobStore = new Map<string, AuditJob>();

// TTL for completed jobs in the in-memory store (24 hours)
const JOB_STORE_TTL_MS = 24 * 60 * 60 * 1000;

// Global stage timeout (5 minutes) — prevents a single stage from hanging forever
const STAGE_TIMEOUT_MS = 5 * 60 * 1000;

// Registry of stages to be executed linearly
const PIPELINE_STAGES: AuditPipelineStage[] = ALL_STAGES;

/**
 * Evict completed/failed jobs older than 24 hours from the in-memory store.
 * Prevents unbounded memory growth on busy servers.
 */
function evictOldJobs(): void {
    const cutoff = Date.now() - JOB_STORE_TTL_MS;
    let evicted = 0;
    for (const [id, job] of jobStore) {
        if ((job.status === "COMPLETED" || job.status === "FAILED") && job.completedAt) {
            const completedTime = new Date(job.completedAt).getTime();
            if (completedTime < cutoff) {
                jobStore.delete(id);
                evicted++;
            }
        }
    }
    if (evicted > 0) {
        console.log(`[AuditPipeline] Evicted ${evicted} old jobs from in-memory store.`);
    }
}

// Periodic cleanup every 30 minutes — unref'd so it doesn't keep the process alive during tests
const cleanupTimer = setInterval(evictOldJobs, 30 * 60 * 1000);
cleanupTimer.unref();

/**
 * Register a stage in the execution pipeline.
 */
export function registerStage(stage: AuditPipelineStage) {
    PIPELINE_STAGES.push(stage);
}

/**
 * Create an empty, initial state report
 */
function createInitialReport(jobAuthIds: { documentId: string; projectId: string }, style: string = "APA"): AuditReport {
    return {
        metadata: {
            auditId: "", // Set in startAudit
            timestamp: new Date().toISOString(),
            documentId: jobAuthIds.documentId,
            projectId: jobAuthIds.projectId,
            style: style,
            version: "1.0.0",
        },
        summary: {
            totalInTextCitations: 0,
            uniqueBibliographyEntries: 0,
            duplicatesDetected: 0,
            brokenCitations: 0,
            uncitedReferences: 0,
            invalidUrls: 0,
            formattingErrors: 0,
            complianceScore: 100, // Starts perfect, penalized down
        },
        issues: [],
        linkValidation: [],
        duplicates: [],
    };
}

/**
 * Initializes and queues a background audit job.
 * Returns the auditId immediately.
 */
export function startAudit(documentId: string, projectId: string, docState: unknown, style: string = "APA", userId: string = ""): string {
    const auditId = uuidv4();
    const job: AuditJob = {
        auditId,
        documentId,
        projectId,
        userId,
        status: "RUNNING",
        progress: 0,
        currentStage: "INITIALIZING",
        startedAt: new Date().toISOString(),
        completedAt: null,
        report: createInitialReport({ documentId, projectId }, style),
    };
    job.report!.metadata.auditId = auditId; // Sync ID
    if (userId) {
        job.report!.metadata.userId = userId;
    }

    jobStore.set(auditId, job);
    persistAuditJobInBackground(job);

    // Evict old completed jobs to prevent memory leak
    evictOldJobs();

    // Fire and forget the background execution
    runPipeline(auditId, docState, userId).catch(err => {
        const message = err instanceof Error ? err.message : "Unknown fatal error";
        const stack = err instanceof Error ? err.stack : "no stack";
        console.error(`[AuditPipeline] Fatal error in job ${auditId}: ${message}`);
        console.error(`[AuditPipeline] Stack: ${stack}`);
        const failedJob = jobStore.get(auditId);
        if (failedJob) {
            failedJob.status = "FAILED";
            failedJob.error = message;
            failedJob.completedAt = new Date().toISOString();
            jobStore.set(auditId, failedJob);
        }
    });

    return auditId;
}

/**
 * Background worker that processes the pipeline stages synchronously
 */
async function runPipeline(auditId: string, docState: unknown, userId: string) {
    const job = jobStore.get(auditId);
    if (!job) throw new Error("Job not found in store");

    // Shared context for the timeline
    const context: AuditContext = {
        userId,
        docState,
        citations: [] as ExtractedCitation[],
        bibliography: [] as ExtractedReference[],
        citationIdMap: new Map<string, ExtractedReference>(),
    };

    try {
        for (const stage of PIPELINE_STAGES) {
            // 1. Update State
            job.currentStage = stage.name;
            jobStore.set(auditId, job);
            // Lightweight status-only persistence for intermediate stages (no full report JSON)
            persistAuditJobStatusInBackground(job);
            console.log(`[AuditPipeline] ${auditId} - Starting Stage: ${stage.name}`);

            // 2. Execute Stage (with global timeout)
            console.log(`[AuditPipeline] ${auditId} - Executing: ${stage.name}...`);
            try {
                await Promise.race([
                    stage.execute(job, context),
                    new Promise<never>((_, reject) =>
                        setTimeout(
                            () => reject(new Error(`Stage "${stage.name}" timed out after ${STAGE_TIMEOUT_MS / 1000}s`)),
                            STAGE_TIMEOUT_MS
                        )
                    ),
                ]);
                console.log(`[AuditPipeline] ${auditId} - Stage ${stage.name} finished successfully.`);
            } catch (error) {
                const message = error instanceof Error ? error.message : "Unknown stage error";
                const stack = error instanceof Error ? error.stack : "no stack";
                console.error(`[AuditPipeline] ${auditId} - Stage FAILED: ${stage.name} - ${message}`);
                console.error(`[AuditPipeline] ${auditId} - Stack: ${stack}`);
                job.report?.issues.push({
                    id: uuidv4(),
                    category: "EXTRACTION",
                    type: "STAGE_FAILED",
                    severity: stage.name === "EXTRACTION" ? "CRITICAL" : "MAJOR",
                    message: `${stage.name} failed: ${message}`,
                    suggestedFix: "Review the audit report for partial results or retry the audit.",
                    autoFixAvailable: false,
                });
            }

            // 3. Accumulate Progress
            job.progress = Math.min(100, job.progress + stage.weight);
            jobStore.set(auditId, job);
            // Lightweight status-only persistence for intermediate stages
            persistAuditJobStatusInBackground(job);

            // Artificial delay to prevent event loop starving on massive docs,
            // and allow SSE to flush if needed.
            await new Promise(resolve => setTimeout(resolve, 50));
        }

        // 4. Finalize
        job.progress = 100;
        job.status = "COMPLETED";
        job.currentStage = "DONE";
        job.completedAt = new Date().toISOString();
        jobStore.set(auditId, job);
        persistAuditJobInBackground(job);

        console.log(`[AuditPipeline] ${auditId} - COMPLETED.`);

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown fatal error";
        const stack = error instanceof Error ? error.stack : "no stack";
        console.error(`[AuditPipeline] ${auditId} - FATAL pipeline error: ${message}`);
        console.error(`[AuditPipeline] ${auditId} - Stack: ${stack}`);
        job.status = "FAILED";
        job.error = message;
        job.completedAt = new Date().toISOString();
        jobStore.set(auditId, job);
        persistAuditJobInBackground(job);
    }
}

/**
 * Retrieve the current state of a registered job.
 */
export function getJobState(auditId: string): AuditJob | null {
    return jobStore.get(auditId) || null;
}
