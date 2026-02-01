import express, { Request, Response } from "express";
import {
    AuditRequest,
    AuditResponse,
    CitationFlag,
    VerificationResult,
    AuditTier
} from "../../types/citationAudit";
import { getStyleRules } from "../../services/citationAudit/styleRules";
import { RiskAnalysisService } from "../../services/citationAudit/riskAnalysisService";

const router = express.Router();

router.post("/audit", async (req: Request, res: Response) => {
    console.log("\n\n🚀🚀🚀 TIERED AUDIT ENDPOINT CALLED! 🚀🚀🚀\n");

    try {
        // 1. Authentication Check
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Missing or invalid authorization header" });
        }

        // Token verification (simplified for brevity, mirroring existing pattern)
        const { getSupabaseClient } = await import("../../lib/supabase/client");
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

        const { declaredStyle, patterns, referenceList, sections, citationLibrary, wordCount } = req.body as AuditRequest & { wordCount?: number };
        const docWordCount = wordCount || 1000;

        // 2. Entitlement Check
        const { EntitlementService } = await import("../../services/EntitlementService");
        try {
            await EntitlementService.assertCanUse(userId, "citation_audit", { wordCount: docWordCount });
        } catch (error: any) {
            let status = 403;
            if (error.code === "INSUFFICIENT_CREDITS") status = 402;
            return res.status(status).json({
                error: error.message || "Plan limit reached.",
                code: error.code || "PLAN_LIMIT_REACHED",
                data: { upgrade_url: "/pricing" }
            });
        }

        console.log("📋 Forensic Audit Request:", { style: declaredStyle, patterns: patterns?.length, normalized: !!citationLibrary });

        // Load Style Rules
        const rules = getStyleRules(declaredStyle);
        const flags: CitationFlag[] = [];
        const tiersExecuted: AuditTier[] = [];
        const tierMetadata: AuditResponse["tierMetadata"] = {};

        // =========================================================================
        // TIER 1: STRUCTURAL AUDIT (Mandatory)
        // Checks format, existence, and uniqueness.
        // =========================================================================
        tiersExecuted.push(AuditTier.STRUCTURAL);

        // 1.1 Inline Pattern Checks (Style Violations)
        if (patterns) {
            patterns.forEach(pattern => {
                if (rules.disallowedInlinePatterns.includes(pattern.patternType)) {
                    flags.push({
                        type: "INLINE_STYLE",
                        ruleId: `${rules.style}.NO_${pattern.patternType}`,
                        message: rules.messages[pattern.patternType] || `Invalid pattern ${pattern.patternType}`,
                        anchor: { start: pattern.start, end: pattern.end, text: pattern.text },
                        tier: AuditTier.STRUCTURAL,
                        reason: `Standard ${declaredStyle} requires ${rules.messages[pattern.patternType] || "different formatting"}.`,
                        action: "Use the 'Fix Formatting' tool in the sidebar.",
                        source: pattern.text
                    });
                }
            });
        }

        // 1.2 Reference Section Check
        if (referenceList) {
            const foundTitle = referenceList.sectionTitle.trim().toLowerCase();
            const validTitles = rules.referenceList.requiredSectionTitle.map(t => t.toLowerCase());
            if (!validTitles.includes(foundTitle)) {
                flags.push({
                    type: "STRUCTURAL",
                    ruleId: `${rules.style}.WRONG_REF_SECTION_TITLE`,
                    section: "Reference List",
                    message: rules.messages["WRONG_SECTION_TITLE"],
                    expected: rules.referenceList.requiredSectionTitle[0],
                    tier: AuditTier.STRUCTURAL,
                    reason: `Heading "${referenceList.sectionTitle}" does not match standard ${declaredStyle} terminology.`,
                    action: `Rename this heading to "${rules.referenceList.requiredSectionTitle[0]}".`
                });
            }
        }

        // 1.3 Citation Matching (Normalization-Aware)
        const { CitationMatcher } = await import("../../services/citationAudit/citationMatcher");
        const validPatterns = patterns || [];
        const validEntries = referenceList?.entries || [];

        const matchedPairs = CitationMatcher.matchCitations(validPatterns, validEntries, declaredStyle, citationLibrary);

        // Analyze Structural Integrity
        let matchedCount = 0;

        // Check for UNMATCHED Citations
        matchedPairs.forEach(pair => {
            if (!pair.reference) {
                // If it's unresolved by normalization, provide a more helpful message
                if (pair.inline.normalizationStatus === "unresolved") {
                    flags.push({
                        type: "STRUCTURAL",
                        ruleId: "UNRESOLVED_CITATION",
                        message: "This citation could not be automatically resolved to a source.",
                        anchor: { start: pair.inline.start, end: pair.inline.end, text: pair.inline.text },
                        tier: AuditTier.STRUCTURAL,
                        reason: "Normalization failed to find a high-confidence match in your library or the bibliography.",
                        action: "Click to search academic databases for this source.",
                        source: pair.inline.text
                    });
                } else {
                    flags.push({
                        type: "STRUCTURAL",
                        ruleId: "UNMATCHED_CITATION",
                        message: "This citation is not linked to any entry in the bibliography.",
                        anchor: { start: pair.inline.start, end: pair.inline.end, text: pair.inline.text },
                        tier: AuditTier.STRUCTURAL,
                        reason: "A corresponding entry for this author/year was not found in the References section.",
                        action: "Add the reference entry or use 'Link to Source' to manually resolve.",
                        source: pair.inline.text
                    });
                }
            } else {
                matchedCount++;
            }
        });

        // Check for ORPHAN References
        const matchedRefIndices = new Set(matchedPairs.map(p => p.reference?.index).filter(i => i !== undefined));
        validEntries.forEach(ref => {
            // Forensic Rule: Do NOT flag if there are unresolved citations (they might point here)
            const hasUnresolved = validPatterns.some(p => p.normalizationStatus === "unresolved");

            if (!matchedRefIndices.has(ref.index)) {
                flags.push({
                    type: "STRUCTURAL",
                    ruleId: "ORPHAN_REFERENCE",
                    message: "This reference is not cited anywhere in the document.",
                    anchor: { start: ref.start, end: ref.end, text: ref.rawText },
                    tier: AuditTier.STRUCTURAL,
                    reason: "The audit engine found no inline citation linking to this specific reference entry.",
                    action: hasUnresolved ? "Review unresolved citations above to see if they should link here." : "Remove this entry or add a corresponding inline citation.",
                    source: ref.rawText.substring(0, 50) + "..."
                });
            }
        });

        tierMetadata[AuditTier.STRUCTURAL] = {
            executed: true,
            stats: {
                totalCitations: validPatterns.length,
                matched: matchedCount,
                orphans: validEntries.length - matchedRefIndices.size
            }
        };

        // =========================================================================
        // TIER 2: CLAIM-LEVEL AUDIT (Conditional)
        // Runs only where citations support factual/quantitative claims.
        // =========================================================================

        // Signal-based filtering for Tier 2 to prioritize high-impact verification
        const claimSignals = ["show", "suggest", "found", "demonstrate", "according to", "percent", "%", "increase", "decrease", "study", "research"];
        const claimAuditCitations = matchedPairs.filter(pair => {
            if (!pair.inline.context) return false;
            return claimSignals.some(signal => pair.inline.context?.toLowerCase().includes(signal));
        });

        let verificationResults: VerificationResult[] = [];

        if (claimAuditCitations.length > 0) {
            tiersExecuted.push(AuditTier.CLAIM);
            console.log(`🔍 [Tier 2] Verifying ${claimAuditCitations.length} claim-bearing citations.`);

            const { ExternalVerificationService } = await import("../../services/citationAudit/externalVerification");
            const rawResults = await ExternalVerificationService.verifyCitationPairs(claimAuditCitations);

            // 🔁 REMEDIATION: If a citation is unsupported or ambiguous, find alternatives
            const { AcademicSearchService } = await import("../../services/academicSearchService");

            verificationResults = await Promise.all(rawResults.map(async (res) => {
                // If support is questionable, try to find better papers
                const needsRemediation = res.supportStatus === "UNSUPPORTED" ||
                    res.supportStatus === "AMBIGUOUS" ||
                    res.existenceStatus === "NOT_FOUND";

                if (needsRemediation) {
                    console.log(`🔎 [Remediation] Searching for alternatives for: ${res.inlineLocation?.text}`);
                    const alternatives = await AcademicSearchService.findEvidenceForClaim(res.inlineLocation?.text || "");

                    return {
                        ...res,
                        reason: res.reason || (res.existenceStatus === "NOT_FOUND" ? "Source could not be located in academic databases." : "The source abstract does not explicitly support this claim."),
                        action: "Review the suggested alternatives below or refine your claim.",
                        suggestions: alternatives.map(p => ({
                            title: p.title,
                            year: p.year,
                            relevanceScore: Math.round((p.similarity || 0) * 100),
                            url: p.url,
                            whyMatch: "Contains terminology closely related to your claim."
                        }))
                    };
                }

                return {
                    ...res,
                    reason: "Source confirmed and aligned with claim context.",
                    action: "No action required."
                };
            }));

            tierMetadata[AuditTier.CLAIM] = {
                executed: true,
                stats: {
                    candidates: claimAuditCitations.length,
                    verified: verificationResults.length,
                    remediations: verificationResults.filter(r => (r.suggestions?.length || 0) > 0).length
                }
            };
        } else {
            tierMetadata[AuditTier.CLAIM] = {
                executed: false,
                skippedReason: "No claim-bearing citations detected in surrounding context."
            };
        }

        // =========================================================================
        // TIER 3: RISK & BIAS AUDIT (Contextual)
        // Runs when risk signals are detected (Medical, Policy).
        // =========================================================================
        const fullText = JSON.stringify(sections || []);
        const shouldRunRisk = RiskAnalysisService.shouldRunRiskAudit(fullText);

        if (shouldRunRisk) {
            tiersExecuted.push(AuditTier.RISK);
            console.log("⚠️ Tier 3 Triggered: Risk signals detected.");

            const riskResult = await RiskAnalysisService.analyzeRisks(
                matchedPairs.map(p => ({ text: p.inline.text, context: p.inline.context }))
            );

            if (riskResult.hasRisk) {
                riskResult.riskFactors.forEach(risk => {
                    flags.push({
                        type: "RISK",
                        ruleId: `RISK_${risk.type}`,
                        message: risk.description,
                        // Attach to document start or relevant citation if we had that mapping
                        anchor: {
                            start: 0,
                            end: 0, // Top of doc
                            text: "Risk Audit"
                        },
                        tier: AuditTier.RISK
                    });
                });
            }

            tierMetadata[AuditTier.RISK] = {
                executed: true,
                stats: { risksFound: riskResult.riskFactors.length }
            };
        } else {
            tierMetadata[AuditTier.RISK] = {
                executed: false,
                skippedReason: "No high-risk domains detected."
            };
        }

        // =========================================================================
        // RESPONSE ASSEMBLY
        // =========================================================================

        // Calculate Integrity Index (Simplified for new model)
        // Base 100
        // -5 per Structural flag
        // -10 per Risk flag
        // -5 per Verification Failure
        let integrityIndex = 100;
        integrityIndex -= (flags.filter(f => f.tier === AuditTier.STRUCTURAL).length * 5);
        integrityIndex -= (flags.filter(f => f.tier === AuditTier.RISK).length * 10);
        integrityIndex -= (verificationResults.filter(r => r.existenceStatus === "NOT_FOUND").length * 5);
        integrityIndex = Math.max(0, integrityIndex);

        const response: AuditResponse = {
            style: declaredStyle,
            flags: flags,
            verificationResults: verificationResults,
            integrityIndex: integrityIndex,
            tiersExecuted: tiersExecuted,
            tierMetadata: tierMetadata
        };

        res.status(200).json(response);

    } catch (error) {
        console.error("Audit Backend Error:", error);
        res.status(500).json({ error: "Internal Audit Error" });
    }
});

export default router;
