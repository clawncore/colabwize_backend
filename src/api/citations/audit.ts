import express, { Request, Response } from "express";
import {
    AuditRequest,
    AuditReport,
    CitationFlag,
    VerificationResult,
    ScoreBreakdownItem
} from "../../types/citationAudit";
import { getStyleRules } from "../../services/citationAudit/styleRules";
import { runUnifiedAudit } from "../../audit/unified-audit";

const router = express.Router();

/**
 * @deprecated Use the unified audit endpoint instead.
 *
 * This synchronous route is retained for backward compatibility with older
 * clients. It now delegates to `runUnifiedAudit` internally and adds a
 * deprecation header pointing clients to the new endpoint.
 */
router.post("/audit", async (req: Request, res: Response) => {
    console.log("\n\n[DEPRECATED] /api/citations/audit called — delegating to unified audit.\n");

    try {
        // 1. Authentication Check
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Missing or invalid authorization header" });
        }

        // Decode token to get userId
        const { getSupabaseClient } = await import("../../lib/supabase/client.js");
        const token = authHeader.substring(7);
        let userId: string;

        try {
            const client = await getSupabaseClient();
            if (!client) throw new Error("Supabase client missing");
            const { data: { user }, error } = await client.auth.getUser(token);
            if (error || !user) throw new Error("Invalid token");
            userId = user.id;
        } catch (e) {
            return res.status(401).json({ error: "Invalid or expired token" });
        }

        const { declaredStyle, patterns, referenceList, sections, wordCount, documentId, projectId } = req.body as AuditRequest & { wordCount?: number; documentId?: string; projectId?: string };

        // 2. Pre-flight Limit Check
        const docWordCount = wordCount || 1000;

        const { SubscriptionService } = await import("../../services/subscriptionService.js");

        const eligibility = await SubscriptionService.checkActionEligibility(userId, "citation_audit", { wordCount: docWordCount });

        if (!eligibility.allowed) {
            let status = 403;
            if (eligibility.code === "INSUFFICIENT_CREDITS") {
                status = 402;
            }

            return res.status(status).json({
                error: eligibility.message || "Plan limit reached.",
                code: eligibility.code || "PLAN_LIMIT_REACHED",
                data: {
                    upgrade_url: "/pricing",
                    limit_info: eligibility
                }
            });
        }

        // 3. Delegate to unified audit
        const unifiedReport = await runUnifiedAudit({
            documentId: documentId ?? "unknown",
            projectId: projectId ?? "unknown",
            userId,
            style: declaredStyle,
            includeForensic: true,
            includeSemantic: true,
            docState: patterns ? { content: [{ type: "paragraph", text: patterns.map(p => p.text).join(" ") }] } : null,
        });

        // 4. Consume credits
        const finalConsumption = await SubscriptionService.consumeAction(userId, "citation_audit", { wordCount: docWordCount });

        // 5. Map unified report back to the legacy response shape for backwards compatibility
        const flags: CitationFlag[] = unifiedReport.forensic.patterns.map((p: any, idx: number) => ({
            type: (p.type === "RISK_FACTOR" ? "STRUCTURAL" : "FORMATTING") as any,
            ruleId: p.ruleId ?? `forensic-${idx}`,
            message: p.message ?? p.description ?? "",
            anchor: p.location ? { start: p.location.start ?? 0, end: p.location.end ?? 0, text: p.detectedPattern ?? "" } : undefined,
            category: p.category,
            section: p.section,
            expected: p.expectedPattern?.[0],
        }));

        // Build verification results from unified report
        const verificationResults: VerificationResult[] = unifiedReport.citations.map((citation: any, idx: number) => ({
            inlineLocation: {
                start: citation.start ?? 0,
                end: citation.end ?? 0,
                text: citation.text ?? "",
            },
            status: idx < unifiedReport.pipeline.verified ? "VERIFIED" : "VERIFICATION_FAILED",
            message: idx < unifiedReport.pipeline.verified ? "Source verified." : "Source could not be verified.",
        }));

        const confirmed = unifiedReport.pipeline.verified;
        const unverified = unifiedReport.pipeline.unverified;
        const unmatched = unifiedReport.pipeline.flagged;
        const duplicates = unifiedReport.pipeline.duplicates;

        const penalties: ScoreBreakdownItem[] = [
            { id: 'unverified', label: 'Unverified Sources', count: unverified, penalty: unverified * 15, impact: 'CRITICAL' },
            { id: 'unmatched', label: 'Broken References', count: unmatched, penalty: unmatched * 10, impact: 'MAJOR' },
            { id: 'duplicates', label: 'Duplicate References', count: duplicates, penalty: duplicates * 5, impact: 'MINOR' },
        ];

        const integrityIndex = unifiedReport.pipeline.score;

        const issues: any[] = [
            ...unifiedReport.warnings.map((w: string) => ({
                id: require("uuid").v4(),
                category: "FORMATTING",
                type: "UNIFIED_WARNING",
                severity: "INFO",
                message: w,
                autoFixAvailable: false,
            })),
            ...unifiedReport.errors.map((e: string) => ({
                id: require("uuid").v4(),
                category: "FORMATTING",
                type: "UNIFIED_ERROR",
                severity: "MAJOR",
                message: e,
                autoFixAvailable: false,
            })),
        ];

        const report: any = {
            style: declaredStyle,
            timestamp: unifiedReport.timestamp.toISOString(),
            flags,
            issues,
            verificationResults,
            detectedStyles: [],
            integrityIndex,
            scoreBreakdown: penalties,
            summary: {
                totalInTextCitations: unifiedReport.pipeline.totalCitations,
                uniqueBibliographyEntries: unifiedReport.bibliography.length,
                brokenCitations: unverified + unmatched,
                uncitedReferences: 0,
                duplicatesDetected: duplicates,
                invalidUrls: 0,
                complianceScore: integrityIndex,
            },
            tierMetadata: {
                CLAIM: { stats: { candidates: unifiedReport.pipeline.totalCitations } },
            },
            // Unified audit fields (new clients can rely on these)
            unified: unifiedReport,
        };

        // Deprecation header pointing to the new unified endpoint
        res.setHeader("Deprecation", "true");
        res.setHeader("Sunset", new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toUTCString());
        res.setHeader("Link", '</api/audit/unified>; rel="successor-version"');

        res.status(200).json(report);

    } catch (error) {
        console.error("Audit Backend Error:", error);
        res.status(500).json({ error: "Internal Audit Error" });
    }
}); // Close /audit route

/**
 * POST /api/citations/audit/unified
 *
 * New unified audit endpoint that runs both pipeline stages and forensic
 * analysis, returning a single consolidated report.
 */
router.post("/audit/unified", async (req: Request, res: Response) => {
    try {
        // 1. Authentication Check
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, error: "Missing or invalid authorization header" });
        }

        const { getSupabaseClient } = await import("../../lib/supabase/client.js");
        const token = authHeader.substring(7);
        let userId: string;

        try {
            const client = await getSupabaseClient();
            if (!client) throw new Error("Supabase client missing");
            const { data: { user }, error } = await client.auth.getUser(token);
            if (error || !user) throw new Error("Invalid token");
            userId = user.id;
        } catch (e) {
            return res.status(401).json({ success: false, error: "Invalid or expired token" });
        }

        const { documentId, projectId, style, includeForensic, includeSemantic, docState } = req.body as {
            documentId?: string;
            projectId?: string;
            style?: string;
            includeForensic?: boolean;
            includeSemantic?: boolean;
            docState?: unknown;
        };

        if (!documentId || !projectId) {
            return res.status(400).json({ success: false, error: "Missing documentId or projectId" });
        }

        // 2. Pre-flight credit check
        const { SubscriptionService } = await import("../../services/subscriptionService.js");
        const eligibility = await SubscriptionService.checkActionEligibility(userId, "citation_audit", { wordCount: 1000 });

        if (!eligibility.allowed) {
            let status = 403;
            if (eligibility.code === "INSUFFICIENT_CREDITS") {
                status = 402;
            }
            return res.status(status).json({
                success: false,
                error: eligibility.message || "Plan limit reached.",
                code: eligibility.code || "PLAN_LIMIT_REACHED",
            });
        }

        // 3. Run unified audit
        const unifiedReport = await runUnifiedAudit({
            documentId,
            projectId,
            userId,
            style,
            includeForensic,
            includeSemantic,
            docState,
        });

        // 4. Consume credits
        await SubscriptionService.consumeAction(userId, "citation_audit", { wordCount: 1000 });

        return res.status(200).json({
            success: true,
            data: unifiedReport,
        });

    } catch (error) {
        console.error("Unified Audit Backend Error:", error);
        return res.status(500).json({ success: false, error: "Internal Unified Audit Error" });
    }
});

export default router;
