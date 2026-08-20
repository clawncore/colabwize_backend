import { v4 as uuidv4 } from "uuid";
import { AuditJob, AuditContext, AuditPipelineStage, ExtractedCitation, ExtractedReference } from "../types";

type ProseMirrorNode = {
    type?: string;
    text?: string;
    attrs?: Record<string, unknown>;
    content?: ProseMirrorNode[];
    marks?: ProseMirrorMark[];
};

type ProseMirrorMark = {
    type?: string;
    attrs?: Record<string, unknown>;
};

type CitationCandidate = ExtractedCitation & { key: string };
type ReferenceCandidate = ExtractedReference & { key: string };

const isReferenceHeading = (text: string): boolean =>
    /(^|\s)(references|works cited|bibliography|literature cited)(\s|$)/i.test(text);

const getText = (node: ProseMirrorNode | undefined): string => {
    if (!node) return "";
    if (node.text) return node.text;
    if (!node.content) return "";
    return node.content.map(getText).join("");
};

const getStringAttr = (node: ProseMirrorNode, key: string): string | undefined => {
    const value = node.attrs?.[key];
    return typeof value === "string" ? value : undefined;
};

const addCitation = (
    citations: CitationCandidate[],
    seenCitations: Set<string>,
    citation: CitationCandidate,
) => {
    if (seenCitations.has(citation.key)) return;
    seenCitations.add(citation.key);
    citations.push(citation);
};

const addReference = (
    references: ReferenceCandidate[],
    seenReferences: Set<string>,
    reference: ReferenceCandidate,
) => {
    if (!reference.text.trim() || reference.text.trim().length <= 5) return;
    if (seenReferences.has(reference.key)) return;
    seenReferences.add(reference.key);
    references.push(reference);
};

const collectManualCitations = (
    text: string,
    start: number,
    citations: CitationCandidate[],
    seenCitations: Set<string>,
) => {
    const manualCitationRegex =
        /(?:\[\s*\d+\s*\]|\(\s*[A-Z][A-Za-z'’.-]+(?:\s+et\s+al\.?)?[,\s]+(?:19|20)\d{2}[a-z]?\s*\))/g;
    let match: RegExpExecArray | null;
    while ((match = manualCitationRegex.exec(text)) !== null) {
        const citationText = match[0];
        const citationStart = start + match.index;
        addCitation(citations, seenCitations, {
            citationId: undefined,
            text: citationText,
            start: citationStart,
            end: citationStart + citationText.length,
            source: "manual",
            key: `manual:${citationStart}:${citationText}`,
        });
    }
};

const isCitationMark = (mark: ProseMirrorMark): boolean => mark.type === "citation";

const collectCitationMarks = (
    node: ProseMirrorNode,
    start: number,
    text: string,
    citations: CitationCandidate[],
    seenCitations: Set<string>,
) => {
    const citationMark = node.marks?.find(isCitationMark);
    if (!citationMark || !text) return;

    addCitation(citations, seenCitations, {
        citationId: getStringAttr({ attrs: citationMark.attrs }, "citationId"),
        text: getStringAttr({ attrs: citationMark.attrs }, "text") || text,
        start,
        end: start + text.length,
        source: "mark",
        key: `mark:${start}:${text}`,
    });
};

const isLeafNode = (type: string | undefined): boolean =>
    type === "image" ||
    type === "hardBreak" ||
    type === "citation" ||
    type === "horizontalRule" ||
    type === "bibliographyEntry";

/**
 * Stage 1: Extraction
 * Parses the ProseMirror JSON tree and extracts structured citations,
 * citation marks, manually typed citations, and bibliography entries.
 *
 * If a previous stage (e.g. GROBID_PARSE) has already populated
 * context.citations and context.bibliography, this stage skips
 * its own extraction and preserves the pre-populated data.
 */
export const ExtractStage: AuditPipelineStage = {
    name: "EXTRACTION",
    weight: 10,
    execute: async (job: AuditJob, context: AuditContext) => {
        if (context.citations.length > 0 || context.bibliography.length > 0) {
            console.log(`[Stage] EXTRACTION: Data already populated (${context.citations.length} citations, ${context.bibliography.length} refs) — skipping.`);
            return;
        }

        const doc = context.docState as ProseMirrorNode | null;
        if (!doc || !Array.isArray(doc.content)) {
            throw new Error("Invalid Document State. Missing content array.");
        }

        const citations: CitationCandidate[] = [];
        const references: ReferenceCandidate[] = [];
        const seenCitations = new Set<string>();
        const seenReferences = new Set<string>();
        let inRefSection = false;

        const walk = (node: ProseMirrorNode, startPos: number): number => {
            const text = getText(node);

            // Check Heading for Bibliography section
            if (node.type === "heading") {
                const headingText = text.toLowerCase();
                inRefSection = isReferenceHeading(headingText);
            }

            // 1. Extract Bibliography Entries
            const isBibNode = node.type === "bibliographyEntry";
            const isRefText = inRefSection && (node.type === "paragraph" || node.type === "listItem");

            if (isBibNode || isRefText) {
                const refText = isBibNode ? (getStringAttr(node, "refText") || text) : text;
                addReference(references, seenReferences, {
                    id: getStringAttr(node, "citationId"),
                    text: refText,
                    url: getStringAttr(node, "url") || null,
                    doi: getStringAttr(node, "doi") || null,
                    start: startPos,
                    end: startPos + refText.length,
                    key: `${node.type}:${startPos}:${refText}`,
                });
            }

            // 2. Extract Inline Citations
            // NOTE: a `citation` node is an atom (inline leaf, size 1) in ProseMirror.
            // Its rendered display text (the "text" attr) can be arbitrarily long
            // (e.g. "[Smith 2020]"), but it occupies exactly ONE position in the
            // document model. Recording end = start + displayText.length would
            // produce a range that overshoots the node and highlights whatever
            // text follows — the "hallucinated highlight" bug. Use start + 1.
            if (node.type === "citation") {
                const citationText = getStringAttr(node, "text") || text || "[Citation]";
                addCitation(citations, seenCitations, {
                    citationId: getStringAttr(node, "citationId"),
                    text: citationText,
                    start: startPos,
                    end: startPos + 1,
                    source: "structured",
                    key: `structured:${startPos}:${citationText}`,
                });
            }

            // Check for citation marks on text nodes
            collectCitationMarks(node, startPos, text, citations, seenCitations);

            // 3. Extract manual citations from plain text outside structured citation nodes
            if (node.type === "text" && node.text && !node.marks?.some(isCitationMark)) {
                collectManualCitations(node.text, startPos, citations, seenCitations);
            }

            // Traverse deeper
            if (node.text) {
                return startPos + node.text.length;
            }

            if (isLeafNode(node.type)) {
                return startPos + 1;
            }

            let nextPos = startPos + 1;
            if (node.content) {
                for (const child of node.content) {
                    nextPos = walk(child, nextPos);
                }
            }
            return nextPos + 1;
        };

        let nextPos = 0;
        for (const child of doc.content) {
            nextPos = walk(child, nextPos);
        }

        const citationIds = new Set(citations.map((citation) => citation.citationId).filter((id): id is string => Boolean(id)));

        // Save to context
        context.citations = citations.map(({ key: _key, ...citation }) => citation);
        context.bibliography = references.map(({ key: _key, ...reference }) => reference);
        context.citationIdMap = new Map(
            context.bibliography
                .filter((reference): reference is ExtractedReference & { id: string } => Boolean(reference.id))
                .map((reference) => [reference.id, reference]),
        );

        // Update Initial Report Metrics
        if (!job.report) throw new Error("Job report missing");
        job.report.summary.totalInTextCitations = citations.length;
        job.report.summary.uniqueBibliographyEntries = references.length;
        job.report.summary.citationTypes = {
            structured: citations.filter((c) => c.source === "structured").length,
            mark: citations.filter((c) => c.source === "mark").length,
            manual: citations.filter((c) => c.source === "manual").length,
        };

        if (citationIds.size === 0 && context.citations.length > 0) {
            job.report.issues.push({
                id: uuidv4(),
                category: "EXTRACTION",
                type: "UNRESOLVED_INLINE_CITATIONS",
                severity: "INFO",
                message: "Inline citations were extracted, but no structured citation IDs were available for direct bibliography lookup.",
                suggestedFix: "The audit will continue using text-based matching and external verification where possible.",
                autoFixAvailable: false,
            });
        }

        console.log(`[Stage] EXTRACTION: Found ${citations.length} citations, ${references.length} ref entries.`);
    },
};
