import { AuditJob, AuditContext, AuditPipelineStage } from "../types";

/**
 * Stage 1: Extraction
 * Parses the ProseMirror structured syntax tree to find citations and references.
 */
export const ExtractStage: AuditPipelineStage = {
    name: "EXTRACTION",
    weight: 10,
    execute: async (job: AuditJob, context: AuditContext) => {
        const doc = context.docState;
        if (!doc || !doc.content) {
            throw new Error("Invalid Document State. Missing content array.");
        }

        let citations: any[] = [];
        let references: any[] = [];
        let inRefSection = false;

        // Headless walk of Prosemirror JSON
        let currentPos = 0; // Starts at 0
        const walk = (node: any) => {
            const startPos = currentPos;

            // Check Heading for Bibliography section
            if (node.type === "heading") {
                const textContent = node.content
                    ? node.content.filter((c: any) => c.text).map((c: any) => c.text).join("").toLowerCase()
                    : "";
                if (textContent.includes("references") || textContent.includes("works cited") || textContent.includes("bibliography")) {
                    inRefSection = true;
                } else if (inRefSection) {
                    inRefSection = false;
                }
            }

            // 1. Extract Bibliography Entries
            const isBibNode = node.type === "bibliographyEntry";
            const isRefText = inRefSection && (node.type === "paragraph" || node.type === "listItem");

            if (isBibNode || isRefText) {
                const textContent = node.content ? node.content.filter((c: any) => c.text).map((c: any) => c.text).join("") : "";
                const text = isBibNode ? (node.attrs?.refText || textContent) : textContent;

                if (text && text.trim().length > 5) {
                    references.push({
                        id: node.attrs?.citationId || text.substring(0, 20),
                        text: text,
                        url: node.attrs?.url || null,
                        doi: node.attrs?.doi || null,
                        start: startPos,
                        end: startPos + text.length
                    });
                }
            }

            // 2. Extract Inline Citations
            if (node.type === "citation") {
                citations.push({
                    citationId: node.attrs?.citationId,
                    text: node.attrs?.text || "[Citation]",
                    start: startPos,
                    end: startPos + 1
                });
            }

            // Check for marks on text nodes
            if (node.marks) {
                const citationMark = node.marks.find((m: any) => m.type === "citation");
                if (citationMark && node.text) {
                    citations.push({
                        citationId: citationMark.attrs?.citationId,
                        text: node.text,
                        start: startPos,
                        end: startPos + node.text.length
                    });
                }
            }

            // Traverse deeper
            if (node.text) {
                currentPos += node.text.length;
            } else if (["image", "hardBreak", "citation", "horizontalRule", "bibliographyEntry"].includes(node.type)) {
                // Leaf nodes only take 1 position
                currentPos += 1;
            } else {
                currentPos += 1; // start token
                if (node.content) node.content.forEach(walk);
                currentPos += 1; // end token
            }
        };

        doc.content.forEach(walk);

        // Save to context
        context.citations = citations;
        context.bibliography = references;

        // Update Initial Report Metrics
        if (!job.report) throw new Error("Job report missing");
        job.report.summary.totalInTextCitations = citations.length;
        job.report.summary.uniqueBibliographyEntries = references.length;

        console.log(`[Stage] EXTRACTION: Found ${citations.length} citations, ${references.length} ref entries.`);
    }
};
