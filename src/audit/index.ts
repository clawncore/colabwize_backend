import express from "express";
import { startAudit, getJobState } from "./pipeline";
import { createClient } from "@supabase/supabase-js";

const router = express.Router();

/**
 * POST /api/audit/start
 * Kicks off a background citation audit job.
 * Returns { auditId } immediately.
 * Auth is handled by the global authenticateExpressRequest middleware.
 */
router.post("/start", (req, res) => {
    try {
        const userId = (req as any).user?.id || "";
        const { documentId, projectId, docState, style } = req.body;

        if (!documentId || !projectId || !docState) {
            return res.status(400).json({ error: "Missing documentId, projectId, or docState fields" });
        }

        const auditId = startAudit(documentId, projectId, docState, style || "APA", userId);
        return res.status(202).json({ success: true, data: { auditId }, message: "Audit background job queued." });

    } catch (error: any) {
        console.error("[AuditEngine] Failed to start task:", error);
        return res.status(500).json({ error: error.message });
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
        return res.status(401).json({ error: "Missing auth token" });
    }

    try {
        const supabase = createClient(
            process.env.SUPABASE_URL || "",
            process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || ""
        );
        const { data, error } = await supabase.auth.getUser(tokenParam);
        if (error || !data.user) {
            return res.status(401).json({ error: "Unauthorized" });
        }
    } catch (authError) {
        console.error("[AuditSSE] Token verification error:", authError);
        return res.status(401).json({ error: "Token verification failed" });
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

export default router;
