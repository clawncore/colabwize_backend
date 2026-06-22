import { v4 as uuidv4 } from "uuid";
import { AuditIssueCategory, AuditJob, AuditContext, AuditPipelineStage, ExtractedReference } from "../types";
import { CitationMatcher } from "../../services/citationAudit/citationMatcher";
import { ExternalVerificationService } from "../../services/citationAudit/externalVerification";
import { CitationStyle, ExtractedPattern, ReferenceEntry, VerificationResult } from "../../types/citationAudit";

/**
 * Stage: Database Verification
 * Replaces the basic "map.ts" logic with intelligent cross-referencing and
 * external DB checks (CrossRef, PubMed, arXiv) to detect hallucinations.
 */
export const VerificationStage: AuditPipelineStage = {
    name: "DB_VERIFICATION",
    weight: 30, // Heavier weight since we are making external DB calls
    execute: async (job: AuditJob, context: AuditContext) => {
        const { citations, bibliography } = context;

        // 1. Format raw extracted arrays for the CitationMatcher
        const formattedInline = citations.map((cit): ExtractedPattern => ({
            text: cit.text,
            start: cit.start,
            end: cit.end,
            section: "BODY", // Added required section property
            patternType: "NUMERIC_BRACKET", // Added a valid PatternType
            context: cit.text // passing the citation itself as context if none other available
        }));

        const formattedRefs: ReferenceEntry[] = bibliography.map((ref, i) => ({
            rawText: ref.text,
            index: i,
            start: ref.start ?? 0,
            end: ref.end ?? ref.start + ref.text.length
        }));

        // 2. Match Citations using robust AI logic, not just UUIDs
        // We'll assume APA as default if style isn't strictly defined
        const style: CitationStyle = job.report!.metadata.style as CitationStyle || "APA";
        const pairs = CitationMatcher.matchCitations(formattedInline, formattedRefs, style);

        // Update the context mapping for later stages
        const refMap = new Map<string, ExtractedReference>();
        bibliography.forEach(ref => {
            if (ref.id) refMap.set(ref.id, ref);
        });
        context.citationIdMap = refMap;

        // 3. Fetch previous audit hashes for incremental audit
        const { prisma: prismaClient } = require("../../lib/prisma");
        const previousHashes = new Set<string>();

        // Guard: Prisma client may not have audit models if not regenerated
        if (prismaClient.auditJob && prismaClient.citationPairHash) {
            try {
                const previousAudit = await prismaClient.auditJob.findFirst({
                    where: {
                        document_id: job.documentId,
                        status: "COMPLETED",
                        id: { not: job.auditId },
                    },
                    orderBy: { completed_at: "desc" },
                    select: { id: true },
                });

                if (previousAudit) {
                    const prevHashes = await prismaClient.citationPairHash.findMany({
                        where: { document_id: job.documentId },
                        select: { pair_hash: true },
                    });
                    prevHashes.forEach((h: any) => previousHashes.add(h.pair_hash));
                    console.log(`[Stage] DB_VERIFICATION: Found ${previousHashes.size} previous pair hashes for incremental audit.`);
                }
            } catch (e) {
                // Incremental audit lookup failure should not block the audit
                console.warn("[Stage] DB_VERIFICATION: Failed to fetch previous hashes, running full audit.", e);
            }
        } else {
            console.log("[Stage] DB_VERIFICATION: Audit models not available on Prisma client — running full audit.");
        }

        // 4. Verify against external databases (with caching + incremental support)
        console.log(`[Stage] DB_VERIFICATION: Fetching DB verification for ${pairs.length} pairs...`);
        const verificationResults: VerificationResult[] = await ExternalVerificationService.verifyCitationPairs(
            pairs,
            context.userId,
            {
                skipUnchanged: previousHashes.size > 0,
                previousHashes,
            }
        );

        // 5. Store current pair hashes for future incremental audits (if Prisma models available)
        if (prismaClient.citationPairHash) {
            try {
                const currentHashes = pairs.map((pair) => ({
                    document_id: job.documentId,
                    project_id: job.projectId,
                    pair_hash: ExternalVerificationService.computePairHash(pair),
                    citation_text: pair.inline.text,
                    reference_text: pair.reference?.rawText ?? null,
                }));

                // Delete old hashes and insert new ones in a transaction
                await prismaClient.$transaction([
                    prismaClient.citationPairHash.deleteMany({
                        where: { document_id: job.documentId },
                    }),
                    ...currentHashes.map((h: any) =>
                        prismaClient.citationPairHash.upsert({
                            where: {
                                document_id_pair_hash: {
                                    document_id: h.document_id,
                                    pair_hash: h.pair_hash,
                                },
                            },
                            create: h,
                            update: h,
                        })
                    ),
                ]);
            } catch (e) {
                console.warn("[Stage] DB_VERIFICATION: Failed to store pair hashes (non-fatal).", e);
            }
        }

        // Map reference index back to verification results
        verificationResults.forEach((res, idx) => {
            res.referenceIndex = pairs[idx].reference?.index;
        });

        // 6. Calculate stats and map flags
        let confirmed = 0;
        let hallucinations = 0;
        let mismatches = 0;
        let unsupported = 0;

        job.report!.flags = [];
        job.report!.issues = job.report!.issues || [];

        let brokenCitations = 0;

        for (const res of verificationResults) {
            if (res.status === 'VERIFIED') { // 'CONFIRMED' is not a valid VerificationStatus
                if (res.semanticSupport?.status !== 'DISPUTED') {
                    confirmed++;
                } else {
                    unsupported++;
                }
            } else if (res.status === 'VERIFICATION_FAILED') { // 'NOT_FOUND' is not a valid VerificationStatus
                hallucinations++;
                brokenCitations++; // A hallucination is effectively a broken link to reality

                // Add to modal flags
                job.report!.flags!.push({
                    ruleId: 'UNVERIFIED_SOURCE',
                    message: res.message,
                    anchor: res.inlineLocation,
                    reason: 'Source could not be found in academic databases.',
                    action: 'Provide a real reference or remove the citation.'
                });

                // Add to standard sidebar issues
                job.report!.issues.push({
                    id: uuidv4(),
                    type: "UNVERIFIED_SOURCE",
                    severity: "CRITICAL",
                    location: { startPos: res.inlineLocation.start, endPos: res.inlineLocation.end },
                    message: res.message,
                    suggestedFix: "Remove or replace with a verified academic source.",
                    suggestedItems: res.suggestedMatches,
                    autoFixAvailable: true
                });

            } else if (res.status === 'UNMATCHED_REFERENCE') {
                brokenCitations++;
                // Add to standard sidebar issues
                job.report!.issues.push({
                    id: uuidv4(),
                    type: "BROKEN_REFERENCE",
                    severity: "MAJOR",
                    location: { startPos: res.inlineLocation.start, endPos: res.inlineLocation.end },
                    message: res.message,
                    suggestedFix: "Add the full reference to the bibliography section.",
                    suggestedItems: res.suggestedMatches,
                    autoFixAvailable: true
                });
            } else {
                mismatches++;
            }
        }

        job.report!.verificationResults = verificationResults;

        // --- NEW V2 METRICS ---
        const startTime = Date.now();

        // 1. Uncited References
        const citedIndices = new Set(verificationResults.map(r => r.referenceIndex).filter(idx => idx !== undefined));
        const uncitedEntries = bibliography.filter((_, idx) => !citedIndices.has(idx));

        // 2. Duplicate Detection
        const duplicates: Array<{ entry1: ExtractedReference; entry2: ExtractedReference; index1: number; index2: number }> = [];
        const extractedMetas = bibliography.map((ref, idx) => ({
            index: idx,
            title: CitationMatcher.extractTitle(ref.text)?.toLowerCase().trim(),
            doi: CitationMatcher.extractDOI(ref.text)?.toLowerCase().trim(),
            year: CitationMatcher.extractYear(ref.text)
        }));

        for (let i = 0; i < extractedMetas.length; i++) {
            for (let j = i + 1; j < extractedMetas.length; j++) {
                const a = extractedMetas[i];
                const b = extractedMetas[j];
                const doiMatch = a.doi && b.doi && a.doi === b.doi;
                const titleMatch = a.title && b.title && a.title === b.title && a.year === b.year;
                if (doiMatch || titleMatch) {
                    duplicates.push({ entry1: bibliography[i], entry2: bibliography[j], index1: i, index2: j });
                }
            }
        }

        // 3. Source Health & URL Validation
        let peerReviewed = 0;
        let webSources = 0;
        let unknownSources = 0;
        let invalidUrls = 0;

        const urlRegex = /https?:\/\/[^\s$.?#].[^\s]*/gi;

        formattedRefs.forEach((ref, index) => {
            const sourceText = ref.rawText;
            const hasDoi = !!CitationMatcher.extractDOI(sourceText);
            const urls = sourceText.match(urlRegex);

            // Simple validation: if verified by DB, it's peer-reviewed
            const isVerified = verificationResults.some(r => r.referenceIndex === index && r.status === 'VERIFIED');

            if (isVerified || hasDoi) {
                peerReviewed++;
            } else if (urls && urls.length > 0) {
                webSources++;
                // Check if URL looks broken (e.g. "http://abc")
                urls.forEach((u: string) => {
                    if (u.length < 10 || !u.includes('.')) invalidUrls++;
                });
            } else {
                unknownSources++;
            }
        });

        // 4. Score Breakdown & Penalties (Proportional to document size)
        //
        // Strategy: Each error is penalised as a fraction of the total citation pool.
        // This prevents a single error on a large document from swinging the score 25 pts.
        // Base penalty per citation type is divided by Math.max(1, totalCitations) to keep
        // jumps realistic. Small decimal precision makes changes feel incremental and honest.

        const totalCitations = Math.max(1, citations.length);
        const totalBib = Math.max(1, bibliography.length);

        // Proportional per-item penalties scaled to document size
        // Max impact of unverified = 8 pts each, capped at 40% total impact
        const unverifiedPenaltyEach = Math.min(8, (60 / totalCitations));
        const brokenPenaltyEach = Math.min(5, (30 / totalCitations));
        const uncitedPenaltyEach = Math.min(2, (10 / totalBib));
        const dupPenaltyEach = Math.min(3, (15 / totalBib));
        const urlPenaltyEach = 2.5;

        const penalties: Array<{ id: string; label: string; count: number; penalty: number; impact: AuditIssueCategory | string }> = [
            { id: 'unverified', label: 'Unverified Sources', count: hallucinations, penalty: parseFloat((hallucinations * unverifiedPenaltyEach).toFixed(2)), impact: 'CRITICAL' },
            { id: 'unmatched', label: 'Broken References', count: brokenCitations - hallucinations, penalty: parseFloat(((brokenCitations - hallucinations) * brokenPenaltyEach).toFixed(2)), impact: 'MAJOR' },
            { id: 'uncited', label: 'Uncited Bibliography Entries', count: uncitedEntries.length, penalty: parseFloat((uncitedEntries.length * uncitedPenaltyEach).toFixed(2)), impact: 'MINOR' },
            { id: 'duplicates', label: 'Duplicate References', count: duplicates.length, penalty: parseFloat((duplicates.length * dupPenaltyEach).toFixed(2)), impact: 'MINOR' },
            { id: 'invalid_urls', label: 'Invalid/Broken URLs', count: invalidUrls, penalty: parseFloat((invalidUrls * urlPenaltyEach).toFixed(2)), impact: 'MAJOR' }
        ];

        const totalPenalty = penalties.reduce((sum, p) => sum + p.penalty, 0);
        // Round to 2 decimal places and never go below 0
        let integrityIndex = parseFloat(Math.max(0, 100 - totalPenalty).toFixed(2));

        // Map issues with categories
        duplicates.forEach(dup => {
            job.report!.issues.push({
                id: uuidv4(),
                category: "DUPLICATES",
                type: "DUPLICATE_REFERENCE",
                severity: "MINOR",
                message: `Duplicate entries found in bibliography. Entry #${dup.index1 + 1} and #${dup.index2 + 1} appear identical.`,
                suggestedFix: "Merge these entries into a single bibliography item.",
                autoFixAvailable: true
            });
        });

        uncitedEntries.forEach(entry => {
            const shortRef = entry.text.substring(0, 50) + "...";
            job.report!.issues.push({
                id: uuidv4(),
                category: "BIBLIOGRAPHY",
                type: "UNCITED_REFERENCE",
                severity: "MINOR",
                message: `Reference "${shortRef}" is listed in the bibliography but never cited in the text.`,
                suggestedFix: "Remove this reference if it's not used, or add an in-text citation.",
                autoFixAvailable: true
            });
        });

        // Add categories to existing issues
        job.report!.issues.forEach((issue) => {
            if (!issue.category) {
                if (issue.type === 'UNVERIFIED_SOURCE') issue.category = 'VERIFICATION';
                else if (issue.type === 'BROKEN_REFERENCE') issue.category = 'MAPPING';
                else issue.category = 'FORMATTING';
            }
        });

        const auditDuration = ((Date.now() - startTime) / 1000).toFixed(1) + "s";

        job.report!.scoreBreakdown = penalties;
        job.report!.integrityIndex = integrityIndex;
        job.report!.summary = {
            totalInTextCitations: citations.length,
            uniqueBibliographyEntries: bibliography.length,
            brokenCitations: brokenCitations,
            uncitedReferences: uncitedEntries.length,
            duplicatesDetected: duplicates.length,
            invalidUrls: invalidUrls,
            formattingErrors: 0,
            complianceScore: integrityIndex,
            sourceHealth: {
                peerReviewed,
                web: webSources,
                unknown: unknownSources
            },
            auditTime: auditDuration
        };

        console.log(`[Stage] DB_VERIFICATION: Hallucinations: ${hallucinations}, Verified: ${confirmed}, Score: ${integrityIndex}/100. Duration: ${auditDuration}`);
    }
};
