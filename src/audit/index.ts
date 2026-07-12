import express, { Request, Response } from "express";
import { startAudit, getJobState } from "./pipeline";
import { createClient } from "@supabase/supabase-js";
import { BillingGateway, BillingError } from "../billing/BillingGateway";

const router = express.Router();

/**
 * POST /api/audit/start
 * Kicks off a background citation audit job.
 * Returns { auditId } immediately.
 * Auth is handled by the global authenticateExpressRequest middleware.
 */
router.post("/start", async (req, res) => {
    try {
        const userId = (req as unknown as { user?: { id?: string } }).user?.id || "";
        const { documentId, projectId, docState, style } = req.body as {
            documentId?: unknown;
            projectId?: unknown;
            docState?: unknown;
            style?: unknown;
        };

        if (!documentId || !projectId || !docState) {
            return res.status(400).json({ success: false, error: "Missing documentId, projectId, or docState fields" });
        }

        // Reserve billing quota before starting the background job. The audit is
        // an async job, so we hold + confirm immediately when we accept it for
        // billing. If the audit later fails in the pipeline, the reconciliation
        // job will catch the orphaned CONSUMED event.
        try {
            const hold = await BillingGateway.hold(userId, "citation_audit");
            await BillingGateway.confirm(hold.eventId);
        } catch (billingError: any) {
            if (billingError instanceof BillingError) {
                const status = billingError.code === "INSUFFICIENT_CREDITS" ? 402 : 403;
                return res.status(status).json({
                    success: false,
                    message: billingError.message,
                    code: billingError.code,
                
        ...billingError.data,
    });
            }
            // Non-billing error from hold (e.g. DB issue) — log but allow the
            // feature to run so billing infrastructure doesn't block the audit.
            console.error("[AuditEngine] Billing hold failed, proceeding:", billingError.message);
        }

        const auditId = startAudit(String(documentId), String(projectId), docState, typeof style === "string" ? style : "APA", userId);
        return res.status(202).json({ success: true, data: { auditId }, message: "Audit background job queued." });

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Audit start failed";
        console.error("[AuditEngine] Failed to start task:", error);
        return res.status(500).json({ success: false, error: message });
    }
});

/**
 * GET /api/audit/progress/:auditId
 * Server-Sent Events (SSE) route to stream real-time progress.
 * Auth token arrives as ?token= query param since EventSource cannot set headers.
 */
router.get("/progress/:auditId", async (req, res) => {
    const { auditId } = req.params;
    const tokenParam = req.query.token as string | undefined;

    // Supabase JWT verification — standard header auth can't be used with EventSource
    if (!tokenParam) {
        return res.status(401).json({ success: false, error: "Missing auth token" });
    }

    try {
        const supabase = createClient(
            process.env.SUPABASE_URL || "",
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ""
        );
        const { data, error } = await supabase.auth.getUser(tokenParam);
        if (error || !data.user) {
            return res.status(401).json({ success: false, error: "Unauthorized" });
        }
    } catch (authError) {
        console.error("[AuditSSE] Token verification error:", authError);
        return res.status(401).json({ success: false, error: "Token verification failed" });
    }

    // SSE Headers
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Initial connected ping
    res.write("data: connected\n\n");

    let isClosed = false;

    // Poll the job store at 100ms and flush to the client
    const interval = setInterval(() => {
        if (isClosed) return;

        const job = getJobState(auditId);

        if (!job) {
            res.write(`data: ${JSON.stringify({ error: "Job not found" })}\n\n`);
            clearInterval(interval);
            res.end();
            return;
        }

        res.write(`data: ${JSON.stringify({
            auditId: job.auditId,
            status: job.status,
            progress: job.progress,
            currentStage: job.currentStage,
            error: job.error,
            report: job.status === "COMPLETED" ? job.report : undefined
        })}\n\n`);

        if (job.status === "COMPLETED" || job.status === "FAILED") {
            clearInterval(interval);
            res.end();
        }
    }, 100);

    // Cleanup on client disconnect
    req.on("close", () => {
        isClosed = true;
        clearInterval(interval);
    });
});

/**
 * GET /api/audit/job/:auditId
 * Returns the current in-memory job state when present, otherwise falls back to
 * the persisted AuditJob / AuditReport rows. This lets clients recover completed
 * audit results after a restart without requiring Redis or SSE resurrection.
 */
router.get("/job/:auditId", async (req: Request, res: Response) => {
    try {
        const { auditId } = req.params as { auditId: string };
        const cached = getJobState(auditId);

        if (cached) {
            return res.json({
                success: true,
                data: {
                    auditId: cached.auditId,
                    status: cached.status,
                    progress: cached.progress,
                    currentStage: cached.currentStage,
                    error: cached.error ?? null,
                    report: cached.report ?? null,
                    source: "memory" as const,
                },
            });
        }

        let report = null;
        let source: "database" | "missing" = "missing";

        try {
            // Persistence may be unavailable locally; surface the missing state gracefully.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let prisma: any = null;
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const { PrismaClient } = require("@prisma/client");
                prisma = new PrismaClient({ log: ["error"] });
            } catch {
                prisma = null;
            }

            if (prisma) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const persistedJob: any = await prisma.auditJob.findUnique({
                    where: { id: auditId },
                    include: { report: { select: { report_json: true } } },
                });
                await prisma.$disconnect();

                if (persistedJob) {
                    report = persistedJob.report?.report_json ?? null;
                    source = "database";
                }
            }
        } catch {
            // Persistence may be unavailable locally; surface the missing state gracefully.
        }

        if (source === "missing") {
            return res.status(404).json({
                success: false,
                error: "Audit job not found in memory or persisted store",
            });
        }

        return res.json({
            success: true,
            data: {
                auditId,
                status: "COMPLETED",
                progress: 100,
                currentStage: "DONE",
                error: null,
                report,
                source,
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Failed to fetch audit job";
        console.error("[AuditEngine] GET /job failed:", error);
        return res.status(500).json({ success: false, error: message });
    }
});

export default router;
