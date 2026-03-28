import { v4 as uuidv4 } from "uuid";
import { AuditJob, AuditReport, AuditContext, AuditPipelineStage } from "./types";

import { ALL_STAGES } from "./stages";

// In-memory store for active/completed audit jobs.
// In a large production environment, this would be Redis.
const jobStore = new Map<string, AuditJob>();

// Registry of stages to be executed linearly
const PIPELINE_STAGES: AuditPipelineStage[] = ALL_STAGES;

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
export function startAudit(documentId: string, projectId: string, docState: any, style: string = "APA", userId: string = ""): string {
    const auditId = uuidv4();
    const job: AuditJob = {
        auditId,
        documentId,
        projectId,
        status: "RUNNING",
        progress: 0,
        currentStage: "INITIALIZING",
        startedAt: new Date().toISOString(),
        completedAt: null,
        report: createInitialReport({ documentId, projectId }, style),
    };
    job.report!.metadata.auditId = auditId; // Sync ID

    jobStore.set(auditId, job);

    // Fire and forget the background execution
    runPipeline(auditId, docState, userId).catch(err => {
        console.error(`[AuditPipeline] Fatal error in job ${auditId}:`, err);
        const failedJob = jobStore.get(auditId);
        if (failedJob) {
            failedJob.status = "FAILED";
            failedJob.error = err.message || "Unknown fatal error";
            failedJob.completedAt = new Date().toISOString();
            jobStore.set(auditId, failedJob);
        }
    });

    return auditId;
}

/**
 * Background worker that processes the pipeline stages synchronously
 */
async function runPipeline(auditId: string, docState: any, userId: string) {
    const job = jobStore.get(auditId);
    if (!job) throw new Error("Job not found in store");

    // Shared context for the timeline
    const context: AuditContext = {
        userId,
        docState,
        citations: [],
        bibliography: [],
        citationIdMap: new Map(),
    };

    try {
        for (const stage of PIPELINE_STAGES) {
            // 1. Update State
            job.currentStage = stage.name;
            jobStore.set(auditId, job);
            console.log(`[AuditPipeline] ${auditId} - Starting Stage: ${stage.name}`);

            // 2. Execute Stage
            console.log(`[AuditPipeline] ${auditId} - Executing: ${stage.name}...`);
            await stage.execute(job, context);
            console.log(`[AuditPipeline] ${auditId} - Stage ${stage.name} finished.`);

            // 3. Accumulate Progress
            job.progress = Math.min(100, job.progress + stage.weight);
            jobStore.set(auditId, job);

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

        console.log(`[AuditPipeline] ${auditId} - COMPLETED.`);

    } catch (error: any) {
        console.error(`[AuditPipeline] ${auditId} - Stage failed:`, error);
        job.status = "FAILED";
        job.error = error.message;
        job.completedAt = new Date().toISOString();
        jobStore.set(auditId, job);
    }
}

/**
 * Retrieve the current state of a registered job.
 */
export function getJobState(auditId: string): AuditJob | null {
    return jobStore.get(auditId) || null;
}
