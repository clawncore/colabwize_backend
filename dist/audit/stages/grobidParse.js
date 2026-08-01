"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GrobidParseStage = void 0;
const uuid_1 = require("uuid");
const grobidService_1 = require("../../services/grobidService");
exports.GrobidParseStage = {
    name: "GROBID_PARSE",
    weight: 5,
    execute: async (job, context) => {
        const docState = context.docState;
        const isPdfMode = docState &&
            typeof docState === "object" &&
            docState.__grobidPdf === true &&
            Buffer.isBuffer(docState.pdfBuffer);
        if (!isPdfMode) {
            console.log("[Stage] GROBID_PARSE: Not PDF mode — skipping.");
            return;
        }
        const pdfBuffer = docState.pdfBuffer;
        const fileName = docState.fileName || "document.pdf";
        console.log(`[Stage] GROBID_PARSE: Processing PDF "${fileName}" (${pdfBuffer.length} bytes)...`);
        const result = await grobidService_1.GrobidService.processPDF(pdfBuffer, fileName);
        if (!result) {
            console.warn("[Stage] GROBID_PARSE: PDF parsing returned no results.");
            job.report.issues.push({
                id: (0, uuid_1.v4)(),
                category: "EXTRACTION",
                type: "PDF_PARSE_FAILED",
                severity: "MAJOR",
                message: "Failed to extract text from PDF. The document may contain only scanned images.",
                suggestedFix: "Ensure the PDF contains machine-readable text (not scanned images).",
                autoFixAvailable: false,
            });
            return;
        }
        const citations = [];
        const references = [];
        for (let i = 0; i < result.references.length; i++) {
            const ref = result.references[i];
            const refId = `grobid-${i}`;
            references.push({
                id: refId,
                text: ref.rawText,
                url: ref.doi ? `https://doi.org/${ref.doi}` : null,
                doi: ref.doi || null,
                start: i,
                end: i + 1,
            });
            const citationText = ref.authors.length > 0
                ? `(${ref.authors[0]}${ref.authors.length > 1 ? " et al." : ""}${ref.year ? `, ${ref.year}` : ""})`
                : ref.title.substring(0, 50);
            citations.push({
                citationId: refId,
                text: citationText,
                start: i,
                end: i + 1,
                source: "structured",
            });
        }
        context.citations = citations;
        context.bibliography = references;
        context.citationIdMap = new Map(references
            .filter((r) => Boolean(r.id))
            .map((r) => [r.id, r]));
        context.docState = { type: "doc", content: [] };
        if (!job.report)
            throw new Error("Job report missing");
        job.report.summary.totalInTextCitations = citations.length;
        job.report.summary.uniqueBibliographyEntries = references.length;
        job.report.grobidExtracted = true;
        job.report.grobidDocumentTitle = result.documentTitle;
        console.log(`[Stage] GROBID_PARSE: Extracted ${citations.length} citations and ${references.length} references from PDF.`);
        if (result.references.length === 0) {
            job.report.issues.push({
                id: (0, uuid_1.v4)(),
                category: "EXTRACTION",
                type: "PDF_NO_REFERENCES",
                severity: "MAJOR",
                message: "Could not extract any references from the PDF.",
                suggestedFix: "Ensure the PDF contains machine-readable text (not scanned images).",
                autoFixAvailable: false,
            });
        }
    },
};
