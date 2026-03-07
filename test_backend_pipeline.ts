import { AuditPipeline } from "./src/audit/pipeline";
import { ExtractStage } from "./src/audit/stages/extract";
import { MatchStage } from "./src/audit/stages/match";
import { VerificationStage } from "./src/audit/stages/verification";
import { MetricsStage } from "./src/audit/stages/metrics";
import { v4 as uuidv4 } from 'uuid';

async function runTest() {
    console.log("🚀 Starting Backend Pipeline Test...");

    // Mock an active Audit Job
    const jobId = uuidv4();
    const mockJob: any = {
        id: jobId,
        userId: "test-system",
        workspaceId: "test-workspace",
        documentId: "test-doc",
        status: "processing",
        progress: 0,
        stagesComplete: [],
        createdAt: new Date(),
        updatedAt: new Date(),
        report: {
            issues: [],
            metrics: { broken: 0, uncited: 0, duplicates: 0, warnings: 0 },
            summary: {
                totalInTextCitations: 0,
                uniqueBibliographyEntries: 0,
                score: 100,
                primaryRisk: "NONE"
            }
        }
    };

    // Mock ProseMirror Document State with a text citation and a bibliography entry
    const mockContext: any = {
        docState: {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        { type: "text", text: "HIV treatment has improved significantly " },
                        { type: "citation", attrs: { citationId: "cit-1", text: "(Deeks, Lewin, & Havlir, 2013)" } },
                        { type: "text", text: "." }
                    ]
                },
                {
                    type: "heading",
                    attrs: { level: 1 },
                    content: [{ type: "text", text: "References" }]
                },
                {
                    type: "bibliographyEntry",
                    attrs: {
                        citationId: "cit-1",
                        refText: "Deeks, S. G., Lewin, S. R., & Havlir, D. V. (2013). The end of AIDS: HIV infection as a chronic disease. The Lancet, 382(9903), 1525-1533."
                    }
                }
            ]
        }
    };

    console.log("📝 Mock Document Loaded:");
    console.log("   - 1 Citation: (Deeks, Lewin, & Havlir, 2013)");
    console.log("   - 1 Bibliography: Deeks, S. G. [...] The Lancet");

    try {
        console.log("\n⚙️  Running EXTRACTION Stage...");
        await ExtractStage.execute(mockJob, mockContext);
        console.log("   ✅ Extracted Citations:", mockContext.citations?.length);
        console.log("   ✅ Extracted References:", mockContext.bibliography?.length);

        console.log("\n⚙️  Running MATCHING Stage...");
        await MatchStage.execute(mockJob, mockContext);
        console.log("   ✅ Matches Found:", mockContext.citationPairs?.length);

        console.log("\n⚙️  Running VERIFICATION Stage (External Databases)...");
        await VerificationStage.execute(mockJob, mockContext);
        
        console.log("\n⚙️  Running METRICS Stage...");
        await MetricsStage.execute(mockJob, mockContext);

        console.log("\n🎉 Pipeline Complete! Final Report Issues:");
        console.log(JSON.stringify(mockJob.report.issues, null, 2));

    } catch (e) {
        console.error("❌ Pipeline Failed:", e);
    }
}

runTest();
