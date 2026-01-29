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
                    console.log("   Creating UNMATCHED_REFERENCE results for all citations");

                    verificationResults = patterns.map(pattern => ({
                        inlineLocation: {
                            start: pattern.start,
                            end: pattern.end,
                            text: pattern.text
                        },
                        status: "UNMATCHED_REFERENCE" as const,
                        message: `No reference list found. Citation "${pattern.text}" has no matching bibliography entry.`
                    }));

                    console.log(`   📝 Created ${verificationResults.length} UNMATCHED_REFERENCE results`);
                }
            } catch (err) {
                console.error("Citation verification failed (non-fatal):", err);
            }
        }

        // Step 7: Construct Response
        const report: AuditReport = {
            style: declaredStyle,
            timestamp: new Date().toISOString(),
            flags,
            verificationResults,  // NEW: Include verification results
            detectedStyles
        };

        // Summary of verification results
        if (verificationResults && verificationResults.length > 0) {
            const verified = verificationResults.filter(r => r.status === "VERIFIED").length;
            const failed = verificationResults.filter(r => r.status === "VERIFICATION_FAILED").length;
            const unmatched = verificationResults.filter(r => r.status === "UNMATCHED_REFERENCE").length;
            const insufficient = verificationResults.filter(r => r.status === "INSUFFICIENT_INFO").length;

            console.log("\n📊 VERIFICATION SUMMARY:");
            console.log(`   ✅ Verified: ${verified}`);
            console.log(`   ❌ Failed: ${failed}`);
            console.log(`   ⚠️  Unmatched: ${unmatched}`);
            console.log(`   📝 Insufficient Info: ${insufficient}`);
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
