import { ExtractStage } from "../extract";
import { AuditJob, AuditContext, AuditReport, ExtractedCitation, ExtractedReference } from "../../types";

/**
 * Regression tests for the EXTRACTION stage.
 *
 * The critical invariant being locked in here: a `citation` node is an
 * inline atom (size 1) in ProseMirror. Its rendered display text
 * (e.g. "[Smith 2020]") can be arbitrarily long, but it occupies exactly
 * ONE position in the document model. The extracted `end` MUST be
 * `start + 1`, NOT `start + displayText.length`.
 *
 * Using `start + displayText.length` was the root cause of the
 * "hallucinated highlight" bug: the frontend received a range that
 * overshot the citation node and highlighted whatever text followed it,
 * making the audit "View in Doc" point to the wrong location.
 */

const makeReport = (): AuditReport => ({
    metadata: { style: "APA" } as any,
    summary: {
        totalInTextCitations: 0,
        uniqueBibliographyEntries: 0,
        citationTypes: { structured: 0, mark: 0, manual: 0 },
        complianceScore: 100,
        brokenCitations: 0,
        uncitedReferences: 0,
        duplicatesDetected: 0,
        invalidUrls: 0,
    },
    issues: [],
    linkValidation: [],
    duplicates: [],
});

const makeJob = (report: AuditReport): AuditJob => ({
    auditId: "test-audit",
    documentId: "test-doc",
    projectId: "test-project",
    userId: "test-user",
    status: "RUNNING",
    progress: 0,
    currentStage: "EXTRACTION",
    startedAt: new Date().toISOString(),
    completedAt: null,
    report,
});

const makeContext = (doc: any): AuditContext => ({
    userId: "test-user",
    docState: doc,
    citations: [],
    bibliography: [],
    citationIdMap: new Map(),
});

describe("ExtractStage — citation atom position invariant", () => {
    it("records end = start + 1 for a structured citation node (not display-text length)", async () => {
        // Document: paragraph containing text, a citation atom, more text.
        // The citation's display text is "[Smith 2020]" (12 chars) but it
        // occupies exactly 1 ProseMirror position.
        const doc = {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        { type: "text", text: "Previous " },
                        {
                            type: "citation",
                            attrs: {
                                citationId: "cite-1",
                                text: "[Smith 2020]",
                            },
                        },
                        { type: "text", text: " after" },
                    ],
                },
            ],
        };

        const report = makeReport();
        const job = makeJob(report);
        const context = makeContext(doc);

        await ExtractStage.execute(job, context);

        const structured = context.citations.filter((c) => c.source === "structured");
        expect(structured).toHaveLength(1);

        const cit = structured[0];
        // "Previous " is 9 chars. The citation starts at position 9
        // (paragraph opening token is position 0, so first text starts at 1,
        // "Hello " would be 1..7, etc. Here "Previous " = 9 chars starting at
        // paragraph-content position 1, so citation is at 10).
        // The key invariant: end must be start + 1, regardless of display text.
        expect(cit.end).toBe(cit.start + 1);
        // And specifically it must NOT be start + displayText.length (12).
        expect(cit.end).not.toBe(cit.start + "[Smith 2020]".length);
    });

    it("tracks positions correctly across multiple citation atoms in one paragraph", async () => {
        const doc = {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        { type: "text", text: "A " },
                        { type: "citation", attrs: { citationId: "c1", text: "[1]" } },
                        { type: "text", text: " B " },
                        { type: "citation", attrs: { citationId: "c2", text: "[Jones 2019]" } },
                        { type: "text", text: " C" },
                    ],
                },
            ],
        };

        const report = makeReport();
        const job = makeJob(report);
        const context = makeContext(doc);

        await ExtractStage.execute(job, context);

        const structured = context.citations.filter((c) => c.source === "structured");
        expect(structured).toHaveLength(2);

        // Each citation atom is exactly 1 position wide.
        for (const cit of structured) {
            expect(cit.end).toBe(cit.start + 1);
        }

        // The two citations must not overlap and must be ordered.
        const [first, second] = structured;
        expect(first.end).toBeLessThanOrEqual(second.start);

        // Gap between them: "A " (2) + citation1 (1) + " B " (3) = 6.
        // But the paragraph opening token (position 0) shifts content to
        // start at 1, so first.start = 3, second.start = 7, gap = 4.
        // The invariant we actually care about: the gap equals the combined
        // size of the text between them (2 + 1 + 3 = 6) MINUS the
        // paragraph-opening-token offset... actually let's just verify the
        // precise tracked positions directly.
        expect(first.start).toBe(3);
        expect(first.end).toBe(4);
        expect(second.start).toBe(7);
        expect(second.end).toBe(8);
    });

    it("handles a citation node whose display text is empty", async () => {
        const doc = {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        { type: "text", text: "x" },
                        { type: "citation", attrs: { citationId: "c1" } },
                        { type: "text", text: "y" },
                    ],
                },
            ],
        };

        const report = makeReport();
        const job = makeJob(report);
        const context = makeContext(doc);

        await ExtractStage.execute(job, context);

        const structured = context.citations.filter((c) => c.source === "structured");
        expect(structured).toHaveLength(1);
        expect(structured[0].end).toBe(structured[0].start + 1);
    });

    it("still records correct text-length-based ranges for manual (plain-text) citations", async () => {
        // Manual citations live inside real text nodes, so their range
        // SHOULD be start + text.length (the actual characters).
        const doc = {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        { type: "text", text: "See [1] for details." },
                    ],
                },
            ],
        };

        const report = makeReport();
        const job = makeJob(report);
        const context = makeContext(doc);

        await ExtractStage.execute(job, context);

        const manual = context.citations.filter((c) => c.source === "manual");
        expect(manual.length).toBeGreaterThanOrEqual(1);
        const m = manual[0];
        // "[1]" is 3 chars: start + 3.
        expect(m.end - m.start).toBe(3);
        expect(m.text).toBe("[1]");
    });
});
