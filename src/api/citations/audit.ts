import express, { Request, Response } from "express";
import {
    AuditRequest,
    AuditReport,
    CitationFlag,
    VerificationResult,
    ScoreBreakdownItem
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

        const { declaredStyle, patterns, referenceList, sections, wordCount } = req.body as AuditRequest & { wordCount?: number };

        // 2. Pre-flight Limit Check (Don't consume yet)
        // User rule: "Citation audit consumes credits based on document length"
        const docWordCount = wordCount || 1000;

        const { SubscriptionService } = await import("../../services/subscriptionService.js");

        // Check if user has enough balance/limit roughly
        // Check if user has enough balance/limit roughly
        const eligibility = await SubscriptionService.checkActionEligibility(userId, "citation_audit", { wordCount: docWordCount });

        if (!eligibility.allowed) {
            // Map reason to status code
            let status = 403;
            if (eligibility.code === "INSUFFICIENT_CREDITS") {
                status = 402; // Payment required/insufficient funds
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

        console.log("📋 Declared Style:", declaredStyle);
        console.log("📝 Patterns received:", patterns ? patterns.length : 0);
        console.log("📚 Reference list:", referenceList ? "Yes" : "No");
        if (referenceList) {
            console.log("   - Entries:", referenceList.entries.length);
        }

        console.log("\n[Audit Lifecycle] STEP 1: LOAD STYLE RULES");
        const rules = getStyleRules(declaredStyle);
        const flags: CitationFlag[] = [];

        console.log("[Audit Lifecycle] STEP 2: CHECK INLINE CITATION VIOLATIONS");
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

        console.log("[Audit Lifecycle] STEP 3: REFERENCE SECTION TITLE CHECK");
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

        console.log("[Audit Lifecycle] STEP 4: REFERENCE ENTRY CHECKS");
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
                        end: firstEntry.end,
                        text: firstEntry.rawText
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

        // Additional Regex Checks: Missing Author/Year in Citation
        if (patterns) {
            patterns.forEach(p => {
                if (p.patternType === 'AUTHOR_YEAR') {
                    const match = p.text.match(/\(([^,]+),\s*(\d{4})?\)/);
                    if (match && !match[2]) {
                        flags.push({
                            type: "INLINE_STYLE",
                            ruleId: `${rules.style}.MISSING_YEAR`,
                            message: "Citation appears to be missing a year.",
                            anchor: { start: p.start, end: p.end, text: p.text }
                        });
                    }
                }
            });
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


        console.log("[Audit Lifecycle] STEP 5: STYLE AUTO-DETECTION COMPLETE");
        
        // Step 6: Citation Matching & External Verification
        console.log("[Audit Lifecycle] STEP 6: STARTING CITATION MATCHING");
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
                    const { CitationMatcher } = await import("../../services/citationAudit/citationMatcher.js");

                    // Match inline citations to reference entries
                    const citationPairs = CitationMatcher.matchCitations(
                        patterns,
                        referenceList.entries,
                        declaredStyle
                    );

                    console.log("\n🔗 Citation Pairs Matched:", citationPairs.length);
                    citationPairs.forEach((pair: any, i: number) => {
                        console.log(`\n  Pair ${i + 1}:`);
                        console.log(`    Inline: "${pair.inline.text}"`);
                        if (pair.reference) {
                            console.log(`    ✅ Matched: ${pair.reference.rawText.substring(0, 60)}...`);
                            console.log(`    📖 Title: ${pair.reference.extractedTitle || 'N/A'}`);
                            console.log(`    👤 Author: ${pair.reference.extractedAuthor || 'N/A'}`);
                            console.log(`    📅 Year: ${pair.reference.extractedYear || 'N/A'}`);
                        } else {
                            console.log(`    ❌ No match found (Author Search: "${pair.inline.text}")`);
                        }
                    });

                    // External verification using free public APIs (CrossRef, arXiv, PubMed)
                    console.log("\n🔍 STARTING VERIFICATION...");
                    const { ExternalVerificationService } = await import("../../services/citationAudit/externalVerification.js");
                    verificationResults = await ExternalVerificationService.verifyCitationPairs(citationPairs);

                    // Map reference index back to verification results
                    verificationResults.forEach((res, idx) => {
                        res.referenceIndex = citationPairs[idx].reference?.index;
                    });

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

        // DEDUCT credits finally
        const finalConsumption = await SubscriptionService.consumeAction(userId, "citation_audit", { wordCount: docWordCount });

        // Step 7: Construct Response with Integrity Metrics
        const confirmed = verificationResults.filter(r => r.status === "VERIFIED" && r.semanticSupport?.status !== "DISPUTED").length;
        const unverified = verificationResults.filter(r => r.status === "VERIFICATION_FAILED").length;
        const unmatched = verificationResults.filter(r => r.status === "UNMATCHED_REFERENCE").length;
        const insufficient = verificationResults.filter(r => r.status === "INSUFFICIENT_INFO").length;

        // --- NEW V2 METRICS ---
        const { CitationMatcher } = require("../../services/citationAudit/citationMatcher");

        // 1. Uncited References (References in list but not in text)
        const citedIndices = new Set(verificationResults.map(r => r.referenceIndex).filter(idx => idx !== undefined));
        const uncitedEntries = referenceList?.entries.filter(e => !citedIndices.has(e.index)) || [];

        // 2. Duplicate Detection
        const duplicates: any[] = [];
        if (referenceList?.entries) {
            const extractedMetas = referenceList.entries.map(e => ({
                index: e.index,
                title: (CitationMatcher as any).extractTitle(e.rawText)?.toLowerCase().trim(),
                doi: (CitationMatcher as any).extractDOI(e.rawText)?.toLowerCase().trim(),
                year: (CitationMatcher as any).extractYear(e.rawText),
                rawText: e.rawText
            }));

            for (let i = 0; i < extractedMetas.length; i++) {
                for (let j = i + 1; j < extractedMetas.length; j++) {
                    const a = extractedMetas[i];
                    const b = extractedMetas[j];
                    const doiMatch = a.doi && b.doi && a.doi === b.doi;
                    const titleMatch = a.title && b.title && a.title === b.title && a.year === b.year;

                    if (doiMatch || titleMatch) {
                        duplicates.push({ entry1: a, entry2: b });
                    }
                }
            }
        }

        // 3. Score Breakdown & Penalties
        const penalties: ScoreBreakdownItem[] = [
            { id: 'unverified', label: 'Unverified Sources', count: unverified, penalty: unverified * 15, impact: 'CRITICAL' },
            { id: 'unmatched', label: 'Broken References', count: unmatched, penalty: unmatched * 10, impact: 'MAJOR' },
            { id: 'uncited', label: 'Uncited Bibliography Entries', count: uncitedEntries.length, penalty: uncitedEntries.length * 2, impact: 'MINOR' },
            { id: 'duplicates', label: 'Duplicate References', count: duplicates.length, penalty: duplicates.length * 5, impact: 'MINOR' },
            { id: 'insufficient', label: 'Insufficient Info', count: insufficient, penalty: insufficient * 2, impact: 'MINOR' }
        ];

        const totalPenalty = penalties.reduce((sum, p) => sum + p.penalty, 0);
        let integrityIndex = Math.max(0, 100 - totalPenalty);

        // Map verification results to issues with categories
        const issues: any[] = [...flags.map(f => ({
            id: require("uuid").v4(),
            category: "FORMATTING",
            type: f.type,
            severity: f.type === "INLINE_STYLE" ? "MINOR" : "MAJOR",
            message: f.message,
            location: f.anchor ? { startPos: f.anchor.start, endPos: f.anchor.end } : undefined,
            suggestedFix: f.expected ? `Use ${f.expected} instead.` : undefined
        }))];

        // Add duplicated issues
        duplicates.forEach(dup => {
            issues.push({
                id: require("uuid").v4(),
                category: "DUPLICATES",
                type: "DUPLICATE_REFERENCE",
                severity: "MINOR",
                message: `Duplicate entries found in bibliography. Entry #${dup.entry1.index + 1} and #${dup.entry2.index + 1} appear identical.`,
                suggestedFix: "Merge these entries into a single bibliography item."
            });
        });

        // Add uncited issues
        uncitedEntries.forEach(entry => {
            const shortRef = entry.rawText.substring(0, 50) + "...";
            issues.push({
                id: require("uuid").v4(),
                category: "BIBLIOGRAPHY",
                type: "UNCITED_REFERENCE",
                severity: "MINOR",
                message: `Reference "${shortRef}" is listed in the bibliography but never cited in the text.`,
                suggestedFix: "Remove this reference if it's not used, or add an in-text citation."
            });
        });

        verificationResults.forEach(res => {
            if (res.status === "VERIFICATION_FAILED") {
                issues.push({
                    id: require("uuid").v4(),
                    category: "VERIFICATION",
                    type: "UNVERIFIED_SOURCE",
                    location: { startPos: res.inlineLocation.start, endPos: res.inlineLocation.end },
                    citationText: res.inlineLocation.text,
                    suggestedFix: "Remove or replace with a verified academic source."
                });
            } else if (res.status === "UNMATCHED_REFERENCE") {
                issues.push({
                    id: require("uuid").v4(),
                    category: "MAPPING",
                    type: "BROKEN_REFERENCE",
                    severity: "MAJOR",
                    message: res.message,
                    location: { startPos: res.inlineLocation.start, endPos: res.inlineLocation.end },
                    citationText: res.inlineLocation.text,
                    suggestedFix: "Add the full reference to the bibliography section."
                });
            }
        });

        const report: any = {
            style: declaredStyle,
            timestamp: new Date().toISOString(),
            flags,
            issues,
            verificationResults,
            detectedStyles,
            integrityIndex,
            scoreBreakdown: penalties,
            summary: {
                totalInTextCitations: patterns.length,
                uniqueBibliographyEntries: referenceList?.entries.length || 0,
                brokenCitations: unverified + unmatched,
                uncitedReferences: uncitedEntries.length,
                duplicatesDetected: duplicates.length,
                invalidUrls: 0,
                complianceScore: integrityIndex
            },
            tierMetadata: {
                CLAIM: { stats: { candidates: patterns.length } }
            }
        };

        console.log("\n📊 AUDIT COMPLETE:", {
            score: integrityIndex,
            verified: confirmed,
            issues: issues.length
        });

        res.status(200).json(report);

    } catch (error) {
        console.error("Audit Backend Error:", error);
        res.status(500).json({ error: "Internal Audit Error" });
    }
}); // Close /audit route

export default router;
