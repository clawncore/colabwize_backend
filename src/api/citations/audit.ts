import express, { Request, Response } from "express";
import {
    AuditRequest,
    AuditReport,
    CitationFlag,
    VerificationResult
} from "../../types/citationAudit";
import { getStyleRules } from "../../services/citationAudit/styleRules";

const router = express.Router();

router.post("/audit", async (req: Request, res: Response) => {
    console.log("\n\n🚀🚀🚀 AUDIT ENDPOINT CALLED! 🚀🚀🚀\n");

    try {
        // 1. Authentication Check
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ error: "Missing or invalid authorization header" });
        }

        // Decode token to get userId (Mock or Real Supabase check)
        // For consistency with other files, let's use the Supabase client logic if possible
        // or just trust the custom middleware if it was mounted (it wasn't).
        // Let's implement quick token verification or use the service.
        // Assuming we need to verify token similar to generate.ts
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

        const { declaredStyle, patterns, referenceList, sections, wordCount } = req.body as AuditRequest & { wordCount?: number };

        // 2. Pre-flight Limit Check (Don't consume yet)
        // User rule: "Citation audit consumes credits based on document length"
        const docWordCount = wordCount || 1000;

        const { EntitlementService } = await import("../../services/EntitlementService");

        try {
            // Unified Check & Consumption
            await EntitlementService.assertCanUse(userId, "citation_audit", { wordCount: docWordCount });
        } catch (error: any) {
            let status = 403;
            if (error.code === "INSUFFICIENT_CREDITS") {
                status = 402;
            }
            return res.status(status).json({
                error: error.message || "Plan limit reached.",
                code: error.code || "PLAN_LIMIT_REACHED",
                data: {
                    upgrade_url: "/pricing"
                }
            });
        }

        console.log("📋 Declared Style:", declaredStyle);
        console.log("📝 Patterns received:", patterns ? patterns.length : 0);
        console.log("📚 Reference list:", referenceList ? "Yes" : "No");
        if (referenceList) {
            console.log("   - Entries:", referenceList.entries.length);
        }

        // Step 1: Load Style Rules (Authoritative)
        const rules = getStyleRules(declaredStyle);
        const flags: CitationFlag[] = [];

        // Step 2: Inline Citation Violations
        if (patterns) {
            patterns.forEach(pattern => {
                // Check if pattern is disallowed for this style
                if (rules.disallowedInlinePatterns.includes(pattern.patternType)) {
                    flags.push({
                        type: "INLINE_STYLE",
                        ruleId: `${rules.style}.NO_${pattern.patternType}`,
                        message: rules.messages[pattern.patternType] || `Invalid pattern ${pattern.patternType}`,
                        anchor: {
                            start: pattern.start,
                            end: pattern.end,
                            text: pattern.text
                        }
                    });
                }
            });
        }

        // Step 3: Reference Section Title Check
        if (referenceList) {
            // Case insensitive check
            const foundTitle = referenceList.sectionTitle.trim();
            const validTitles = rules.referenceList.requiredSectionTitle.map(t => t.toLowerCase());

            if (!validTitles.includes(foundTitle.toLowerCase())) {
                flags.push({
                    type: "STRUCTURAL",
                    ruleId: `${rules.style}.WRONG_REF_SECTION_TITLE`,
                    section: "Reference List",
                    message: rules.messages["WRONG_SECTION_TITLE"],
                    expected: rules.referenceList.requiredSectionTitle[0]
                });
            }
        } else {
            // Check if user has "References" but we didn't extract it as referenceList?
            // Or if document is long enough to require one?
            // For now, only flag if extracted list title is explicitly wrong.
            // But we can check sections too.
            const refSection = sections.find(s => s.type === "REFERENCE_SECTION");
            if (refSection) {
                const foundTitle = refSection.title.trim();
                const validTitles = rules.referenceList.requiredSectionTitle.map(t => t.toLowerCase());
                if (!validTitles.includes(foundTitle.toLowerCase())) {
                    flags.push({
                        type: "STRUCTURAL",
                        ruleId: `${rules.style}.WRONG_REF_SECTION_TITLE`,
                        section: "Reference List",
                        message: rules.messages["WRONG_SECTION_TITLE"],
                        expected: rules.referenceList.requiredSectionTitle[0]
                    });
                }
            }
        }

        // Step 4: Reference Entry Checks
        if (referenceList && referenceList.entries.length > 0) {
            // Check Numbering
            const firstEntry = referenceList.entries[0];
            const isNumbered = /^\s*\[\d+\]/.test(firstEntry.rawText) || /^\s*\d+\./.test(firstEntry.rawText);

            if (rules.referenceList.numberingAllowed === false && isNumbered) {
                // Violation: Numbered but shouldn't be
                flags.push({
                    type: "REF_LIST_ENTRY",
                    ruleId: `${rules.style}.NUMBERED_ENTRIES_DISALLOWED`,
                    section: referenceList.sectionTitle,
                    message: rules.messages["NUMBERED_ENTRIES_DISALLOWED"],
                    anchor: {
                        start: firstEntry.start,
                        end: firstEntry.start + 3, // Highlight the number part approx
                        text: firstEntry.rawText.substring(0, 3) + "..."
                    }
                });
            } else if (rules.referenceList.numberingAllowed === true && !isNumbered) {
                // Violation: Not numbered but should be (IEEE)
                flags.push({
                    type: "REF_LIST_ENTRY",
                    ruleId: `${rules.style}.NUMBERED_ENTRIES_REQUIRED`,
                    section: referenceList.sectionTitle,
                    message: rules.messages["NUMBERED_ENTRIES_REQUIRED"],
                    anchor: {
                        start: firstEntry.start,
                        end: firstEntry.start + 10,
                        text: firstEntry.rawText.substring(0, 10) + "..."
                    }
                });
            }
        }

        // Step 5: Auto-Detection Logic
        const detectedStyles: string[] = [];
        if (patterns && patterns.length > 0) {
            // Fingerprints registry
            const FINGERPRINTS: Record<string, { inline: string[] }> = {
                "MLA": { inline: ["AUTHOR_PAGE", "et_al_with_period"] },
                "APA": { inline: ["AUTHOR_YEAR", "AMPERSAND_IN_PAREN"] },
                "IEEE": { inline: ["NUMERIC_BRACKET"] },
                "Chicago": { inline: [] } // Todo: Footnotes
            };

            const styleCandidates = Object.entries(FINGERPRINTS).filter(([style, fingerprint]) => {
                return patterns.some(p => fingerprint.inline.includes(p.patternType as any));
            }).map(([style]) => style);

            detectedStyles.push(...styleCandidates);
        }


        // Step 6: Citation Matching & External Verification
        let verificationResults: VerificationResult[] = [];

        // Process citations even if there's no reference list
        if (patterns && patterns.length > 0) {
            try {
                console.log("\n========== CITATION MATCHING DEBUG ==========");
                console.log("📝 Inline Citations Found:", patterns.length);
                patterns.forEach((p, i) => {
                    console.log(`  [${i + 1}] "${p.text}" at position ${p.start}-${p.end}`);
                });

                // Check if we have a reference list
                if (referenceList && referenceList.entries.length > 0) {
                    console.log("\n📚 Reference Entries Found:", referenceList.entries.length);
                    referenceList.entries.forEach((r, i) => {
                        console.log(`  [${i + 1}] ${r.rawText.substring(0, 80)}...`);
                    });

                    // Import services
                    const { CitationMatcher } = await import("../../services/citationAudit/citationMatcher");

                    // Match inline citations to reference entries
                    const citationPairs = CitationMatcher.matchCitations(
                        patterns,
                        referenceList.entries,
                        declaredStyle
                    );

                    console.log("\n🔗 Citation Pairs Matched:", citationPairs.length);
                    citationPairs.forEach((pair, i) => {
                        console.log(`\n  Pair ${i + 1}:`);
                        console.log(`    Inline: "${pair.inline.text}"`);
                        if (pair.reference) {
                            console.log(`    ✅ Matched: ${pair.reference.rawText.substring(0, 60)}...`);
                            console.log(`    📖 Title: ${pair.reference.extractedTitle || 'N/A'}`);
                            console.log(`    👤 Author: ${pair.reference.extractedAuthor || 'N/A'}`);
                            console.log(`    📅 Year: ${pair.reference.extractedYear || 'N/A'}`);
                        } else {
                            console.log(`    ❌ No match found`);
                        }
                    });

                    // External verification using free public APIs (CrossRef, arXiv, PubMed)
                    console.log("\n🔍 STARTING VERIFICATION...");
                    const { ExternalVerificationService } = await import("../../services/citationAudit/externalVerification");
                    verificationResults = await ExternalVerificationService.verifyCitationPairs(citationPairs);
                    console.log("✅ Verification complete:", verificationResults.length, "results");
                } else {
                    // NO REFERENCE LIST - All citations are unmatched
                    console.log("\n⚠️  NO REFERENCE LIST FOUND");
                    console.log("   Creating NOT_FOUND existence results for all citations");

                    verificationResults = patterns.map(pattern => ({
                        inlineLocation: {
                            start: pattern.start,
                            end: pattern.end,
                            text: pattern.text
                        },
                        existenceStatus: "NOT_FOUND",
                        supportStatus: "NOT_EVALUATED",
                        provenance: [],
                        message: `No reference list found. Citation "${pattern.text}" has no matching bibliography entry.`
                    }));

                    console.log(`   📝 Created ${verificationResults.length} fallback results`);
                }
            } catch (err) {
                console.error("Citation verification failed (non-fatal):", err);
            }
        }

        // Step 7: Calculate Citation Integrity Index (CII)
        // Weighting: Style (30%), Verification (30%), Reference (20%), Semantic (20%)
        const calculateCII = (flags: CitationFlag[], verificationResults: VerificationResult[], docWordCount: number) => {
            // 1. Style Score (30%)
            // Penalty based on density: 1 violation per 500 words is acceptable
            const styleViolations = flags.filter(f => f.type === "INLINE_STYLE" || f.type === "REF_LIST_ENTRY").length;
            const acceptableViolations = Math.max(1, Math.ceil(docWordCount / 500));
            const stylePenalty = Math.max(0, styleViolations - acceptableViolations) * 5; // 5 points per excess violation
            const styleScore = Math.max(0, 100 - stylePenalty);

            // 2. Verification Score (30%) - Existence
            const totalCitations = verificationResults.length;
            let verificationScore = 100;
            if (totalCitations > 0) {
                const confirmedCount = verificationResults.filter(r => r.existenceStatus === "CONFIRMED").length;
                const notFoundCount = verificationResults.filter(r => r.existenceStatus === "NOT_FOUND").length;
                // Weighted deduction: Not Found is heavy penalty
                const verifyRatio = confirmedCount / totalCitations;
                verificationScore = Math.round(verifyRatio * 100);
            }

            // 3. Reference Score (20%) - Structural
            // Simple check: Do we have a reference list? Are there unmatched refs?
            const unmatchedRefs = verificationResults.filter(r => r.existenceStatus === "NOT_FOUND" && r.message.includes("No reference list")).length;
            let referenceScore = 100;
            if (!referenceList) referenceScore = 0;
            else if (unmatchedRefs > 0) referenceScore = 50;

            // 4. Semantic Score (20%) - Support
            // Only evaluate confirmed citations
            const confirmedResults = verificationResults.filter(r => r.existenceStatus === "CONFIRMED");
            let semanticScore = 100;
            if (confirmedResults.length > 0) {
                const supported = confirmedResults.filter(r => r.supportStatus === "SUPPORTED").length;
                const plausible = confirmedResults.filter(r => r.supportStatus === "PLAUSIBLE").length;
                const contradictory = confirmedResults.filter(r => r.supportStatus === "CONTRADICTORY").length;

                // Formula: (Supported * 1 + Plausible * 0.8 - Contradictory * 1) / Total
                const rawScore = ((supported * 1) + (plausible * 0.8) - (contradictory * 1));
                const ratio = Math.max(0, rawScore) / confirmedResults.length;
                semanticScore = Math.round(ratio * 100);
            }

            // Weighted Total
            const totalScore = Math.round(
                (styleScore * 0.30) +
                (verificationScore * 0.30) +
                (referenceScore * 0.20) +
                (semanticScore * 0.20)
            );

            // Determine Confidence Level
            let confidence: "HIGH" | "MEDIUM" | "LOW" = "HIGH";
            if (totalCitations === 0) confidence = "LOW";
            else if (verificationResults.some(r => r.existenceStatus === "SERVICE_ERROR")) confidence = "MEDIUM";
            else if (totalScore < 50) confidence = "LOW";

            // Limits
            const limits: string[] = [];
            if (totalCitations === 0) limits.push("No citations found to verify.");
            if (verificationResults.some(r => r.existenceStatus === "SERVICE_ERROR")) limits.push("External verification service unavailable.");
            if (!referenceList) limits.push("No reference list found.");

            return {
                totalScore,
                confidence,
                components: {
                    styleScore,
                    referenceScore,
                    verificationScore,
                    semanticScore
                },
                verificationLimits: limits
            };
        };

        const integrityIndex = calculateCII(flags, verificationResults, docWordCount);

        // Step 8: Construct Response
        const report: AuditReport = {
            style: declaredStyle,
            timestamp: new Date().toISOString(),
            flags,
            verificationResults,
            detectedStyles,
            integrityIndex // NEW: Include CII
        };

        // Summary of verification results
        if (verificationResults && verificationResults.length > 0) {
            const confirmed = verificationResults.filter(r => r.existenceStatus === "CONFIRMED").length;
            const notFound = verificationResults.filter(r => r.existenceStatus === "NOT_FOUND").length;
            const serviceError = verificationResults.filter(r => r.existenceStatus === "SERVICE_ERROR").length;
            const pending = verificationResults.filter(r => r.existenceStatus === "PENDING").length;

            console.log("\n📊 VERIFICATION SUMMARY:");
            console.log(`   ✅ Confirmed: ${confirmed}`);
            console.log(`   ❌ Not Found: ${notFound}`);
            console.log(`   ⚠️  Service Error: ${serviceError}`);
            console.log(`   📝 Pending: ${pending}`);
            console.log(`   📦 Total Results: ${verificationResults.length}`);
        }

        // Credits already deducted by EntitlementService.assertCanUse at the start.

        res.status(200).json(report);

    } catch (error) {
        console.error("Audit Backend Error:", error);
        res.status(500).json({ error: "Internal Audit Error" });
    }
}); // Close /audit route

export default router;
