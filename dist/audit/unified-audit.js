"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.runUnifiedAudit = runUnifiedAudit;
const uuid_1 = require("uuid");
const extract_1 = require("./stages/extract");
const verification_1 = require("./stages/verification");
const duplicateCheck_1 = require("./stages/duplicateCheck");
const urlCheck_1 = require("./stages/urlCheck");
const styleCheck_1 = require("./stages/styleCheck");
const score_1 = require("./stages/score");
const riskAnalysisService_1 = require("../services/citationAudit/riskAnalysisService");
const CitationPatternObserver_1 = require("../services/citationAudit/CitationPatternObserver");
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
const PIPELINE_STAGES = [
    extract_1.ExtractStage,
    verification_1.VerificationStage,
    duplicateCheck_1.DuplicateCheckStage,
    urlCheck_1.UrlCheckStage,
    styleCheck_1.StyleCheckStage,
    score_1.ScoreStage,
];
/**
 * Creates a minimal AuditJob / AuditContext pair for the pipeline stages to
 * consume, without going through the background-job infrastructure.
 */
function createLocalJob(options) {
    const job = {
        auditId: (0, uuid_1.v4)(),
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
    job.report.metadata.auditId = job.auditId;
    const context = {
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
async function runUnifiedAudit(options) {
    const warnings = [];
    const errors = [];
    // --- 1. Run pipeline stages -------------------------------------------
    const { job, context } = createLocalJob(options);
    for (const stage of PIPELINE_STAGES) {
        try {
            await stage.execute(job, context);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unknown stage error";
            errors.push(`Pipeline stage "${stage.name}" failed: ${message}`);
            // Continue with remaining stages — partial results are still useful
        }
    }
    // Mark job completed even if some stages errored
    job.status = errors.length > 0 ? "COMPLETED" : "COMPLETED";
    job.completedAt = new Date().toISOString();
    // --- 2. Run forensic analysis -----------------------------------------
    const forensicPatterns = [];
    const semanticIssues = [];
    let riskLevel = "low";
    const includeForensic = options.includeForensic !== false; // default true
    const includeSemantic = options.includeSemantic !== false; // default true
    if (includeForensic) {
        try {
            // Reconstruct full document text from docState for pattern observation
            const docText = extractPlainText(context.docState);
            const activeStyle = (options.style ?? "APA");
            // Pattern observation
            const flags = CitationPatternObserver_1.CitationPatternObserver.observe(docText, activeStyle);
            forensicPatterns.push(...flags);
            // Mixed-style detection
            const mixedFlags = CitationPatternObserver_1.CitationPatternObserver.detectMixedStyles(docText);
            forensicPatterns.push(...mixedFlags);
            // Risk analysis — build citation-like input from extracted data
            const citationInput = context.citations.map((c) => ({
                text: c.text,
                context: c.text,
            }));
            const riskResult = await riskAnalysisService_1.RiskAnalysisService.analyzeRisks(citationInput);
            if (riskResult.hasRisk) {
                const highSeverity = riskResult.riskFactors.some((r) => r.severity === "HIGH");
                const mediumSeverity = riskResult.riskFactors.some((r) => r.severity === "MEDIUM");
                riskLevel = highSeverity ? "high" : mediumSeverity ? "medium" : "low";
                forensicPatterns.push(...riskResult.riskFactors.map((r) => ({
                    type: "RISK_FACTOR",
                    riskType: r.type,
                    description: r.description,
                    severity: r.severity,
                })));
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unknown forensic error";
            warnings.push(`Forensic analysis partially failed: ${message}`);
        }
    }
    if (includeSemantic) {
        try {
            // Semantic claim verification — run on verified citation pairs
            const verificationResults = job.report?.verificationResults ?? [];
            for (const result of verificationResults) {
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
        }
        catch (error) {
            const message = error instanceof Error ? error.message : "Unknown semantic error";
            warnings.push(`Semantic claim verification partially failed: ${message}`);
        }
    }
    // --- 3. Merge into unified report --------------------------------------
    const report = job.report;
    const verified = report.verificationResults?.filter((r) => r.status === "VERIFIED").length ?? 0;
    const unverified = report.verificationResults?.filter((r) => r.status === "VERIFICATION_FAILED").length ?? 0;
    const flagged = (report.flags?.length ?? 0) + forensicPatterns.length;
    const duplicates = report.summary.duplicatesDetected ?? 0;
    const score = report.summary.complianceScore ?? report.integrityIndex ?? 100;
    const unifiedReport = {
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
function extractPlainText(docState) {
    if (!docState || typeof docState !== "object")
        return "";
    const node = docState;
    if (!Array.isArray(node.content))
        return "";
    const walk = (n) => {
        if (n.text)
            return n.text;
        if (Array.isArray(n.content))
            return n.content.map((child) => walk(child)).join("");
        return "";
    };
    return node.content.map((child) => walk(child)).join(" ");
}
