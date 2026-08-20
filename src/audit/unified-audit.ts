/**
 * Unified Audit Entry Point
 *
 * Merges the pipeline-based audit system with the forensic analysis services
 * into a single, coherent audit flow:
 *
 *   Pipeline stages (extract -> verify -> deduplicate -> map -> style -> score)
 *   followed by
 *   Forensic analysis (risk analysis, pattern observation, semantic claim verification)
 *
 * The result is a single UnifiedAuditReport that consolidates findings from both
 * subsystems into one response shape.
 */

import { v4 as uuidv4 } from "uuid";

import { AuditJob, AuditContext, AuditReport } from "./types";
import { ALL_STAGES } from "./stages";

import { RiskAnalysisService } from "../services/citationAudit/riskAnalysisService";
import { CitationPatternObserver } from "../services/citationAudit/CitationPatternObserver";
import { SemanticClaimService } from "../services/citationAudit/semanticClaimService";
import { CitationStyle } from "../types/citationAudit";

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface UnifiedAuditOptions {
    documentId: string;
    projectId: string;
    userId: string;
    style?: string; // APA, MLA, Chicago, IEEE
    includeForensic?: boolean;
    includeSemantic?: boolean;
    docState?: unknown;
}

export interface UnifiedAuditReport {
    documentId: string;
    projectId: string;
    timestamp: Date;
    citations: any[];
    bibliography: any[];
    pipeline: {
        totalCitations: number;
        verified: number;
        unverified: number;
        flagged: number;
        duplicates: number;
        score: number;
    };
    forensic: {
        riskLevel: "low" | "medium" | "high";
        patterns: any[];
        semanticIssues: any[];
    };
    warnings: string[];
    errors: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const PIPELINE_STAGES = ALL_STAGES;

/**
 * Creates a minimal AuditJob / AuditContext pair for the pipeline stages to
 * consume, without going through the background-job infrastructure.
 */
function createLocalJob(options: UnifiedAuditOptions): { job: AuditJob; context: AuditContext } {
    const job: AuditJob = {
        auditId: uuidv4(),
        documentId: options.documentId,
        projectId: options.projectId,
        userId: options.userId,
        status: "RUNNING",
        progress: 0,
        currentStage: "INITIALIZING",
        startedAt: new Date().toISOString(),
        completedAt: null,
        report: {
            metadata: {
                auditId: "",
                timestamp: new Date().toISOString(),
                documentId: options.documentId,
                projectId: options.projectId,
                userId: options.userId,
                style: options.style ?? "APA",
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
                complianceScore: 100,
            },
            issues: [],
            linkValidation: [],
            duplicates: [],
        },
    };
    job.report!.metadata.auditId = job.auditId;

    const context: AuditContext = {
        userId: options.userId,
        docState: options.docState ?? null,
        citations: [],
        bibliography: [],
        citationIdMap: new Map(),
    };

    return { job, context };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the full unified audit: pipeline stages first, then forensic analysis.
 *
 * @param options - document / project / user context and feature flags
 * @returns A single unified report combining pipeline and forensic findings
 */
export async function runUnifiedAudit(options: UnifiedAuditOptions): Promise<UnifiedAuditReport> {
    const warnings: string[] = [];
    const errors: string[] = [];

    // --- 1. Run pipeline stages -------------------------------------------

    const { job, context } = createLocalJob(options);

    for (const stage of PIPELINE_STAGES) {
        try {
            await stage.execute(job, context);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown stage error";
            errors.push(`Pipeline stage "${stage.name}" failed: ${message}`);
            // Continue with remaining stages — partial results are still useful
        }
    }

    // Mark job completed even if some stages errored
    job.status = errors.length > 0 ? "COMPLETED" : "COMPLETED";
    job.completedAt = new Date().toISOString();

    // --- 2. Run forensic analysis -----------------------------------------

    const forensicPatterns: any[] = [];
    const semanticIssues: any[] = [];
    let riskLevel: "low" | "medium" | "high" = "low";

    const includeForensic = options.includeForensic !== false; // default true
    const includeSemantic = options.includeSemantic !== false; // default true

    if (includeForensic) {
        try {
            // Reconstruct full document text from docState for pattern observation
            const docText = extractPlainText(context.docState);
            const activeStyle = (options.style ?? "APA") as CitationStyle;

            // Pattern observation
            const flags = CitationPatternObserver.observe(docText, activeStyle);
            forensicPatterns.push(...flags);

            // Mixed-style detection
            const mixedFlags = CitationPatternObserver.detectMixedStyles(docText);
            forensicPatterns.push(...mixedFlags);

            // Risk analysis — build citation-like input from extracted data
            const citationInput = context.citations.map((c) => ({
                text: c.text,
                context: c.text,
            }));
            const riskResult = await RiskAnalysisService.analyzeRisks(citationInput);

            if (riskResult.hasRisk) {
                const highSeverity = riskResult.riskFactors.some((r) => r.severity === "HIGH");
                const mediumSeverity = riskResult.riskFactors.some((r) => r.severity === "MEDIUM");
                riskLevel = highSeverity ? "high" : mediumSeverity ? "medium" : "low";
                forensicPatterns.push(
                    ...riskResult.riskFactors.map((r) => ({
                        type: "RISK_FACTOR",
                        riskType: r.type,
                        description: r.description,
                        severity: r.severity,
                    })),
                );
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown forensic error";
            warnings.push(`Forensic analysis partially failed: ${message}`);
        }
    }

    if (includeSemantic) {
        try {
            // Semantic claim verification — run on verified citation pairs
            const verificationResults = job.report?.verificationResults ?? [];
            for (const result of verificationResults as any[]) {
                if (result.status === "VERIFIED" && result.semanticSupport) {
                    const supportStatus = result.semanticSupport.status;
                    if (supportStatus === "DISPUTED" || supportStatus === "UNRELATED") {
                        semanticIssues.push({
                            citationText: result.inlineLocation?.text ?? "",
                            status: supportStatus,
                            reasoning: result.semanticSupport.reasoning,
                            confidence: result.semanticSupport.confidence,
                        });
                    }
                }
            }
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unknown semantic error";
            warnings.push(`Semantic claim verification partially failed: ${message}`);
        }
    }

    // --- 3. Merge into unified report --------------------------------------

    const report = job.report!;
    const verified = (report.verificationResults as any[])?.filter((r: any) => r.status === "VERIFIED").length ?? 0;
    const unverified = (report.verificationResults as any[])?.filter((r: any) => r.status === "VERIFICATION_FAILED").length ?? 0;
    const flagged = (report.flags?.length ?? 0) + forensicPatterns.length;
    const duplicates = report.summary.duplicatesDetected ?? 0;
    const score = report.summary.complianceScore ?? report.integrityIndex ?? 100;

    const unifiedReport: UnifiedAuditReport = {
        documentId: options.documentId,
        projectId: options.projectId,
        timestamp: new Date(),
        citations: context.citations,
        bibliography: context.bibliography,
        pipeline: {
            totalCitations: context.citations.length,
            verified,
            unverified,
            flagged,
            duplicates,
            score,
        },
        forensic: {
            riskLevel,
            patterns: forensicPatterns,
            semanticIssues,
        },
        warnings,
        errors,
    };

    return unifiedReport;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Best-effort plain-text extraction from a ProseMirror JSON document.
 * Falls back to empty string when docState is absent or malformed.
 */
function extractPlainText(docState: unknown): string {
    if (!docState || typeof docState !== "object") return "";

    type DocNode = { text?: string; content?: DocNode[] };
    const node = docState as { content?: DocNode[] };
    if (!Array.isArray(node.content)) return "";

    const walk = (n: DocNode): string => {
        if (n.text) return n.text;
        if (Array.isArray(n.content)) return n.content.map((child: DocNode) => walk(child)).join("");
        return "";
    };

    return node.content.map((child: DocNode) => walk(child)).join(" ");
}
