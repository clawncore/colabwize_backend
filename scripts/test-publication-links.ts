
import { PublicationExportService } from "../src/services/publicationExportService";
import { prisma } from "../src/lib/prisma";
import fs from "fs";
import path from "path";

// Mock Prisma
jest.mock("../src/lib/prisma", () => ({
    prisma: {
        project: {
            findFirst: jest.fn()
        }
    }
}));

async function testExport() {
    console.log("Starting Export Test...");

    const mockProject = {
        id: "test-proj-123",
        title: "Test Export with Links",
        content: {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        { type: "text", text: "This is a statement with a citation " },
                        {
                            type: "citation",
                            attrs: { citationId: "cit-1", fallback: "(Smith, 2023)" },
                            marks: []
                        },
                        { type: "text", text: "." }
                    ]
                }
            ]
        },
        citations: [
            {
                id: "cit-1",
                authors: [{ lastName: "Smith", firstName: "John" }],
                year: "2023",
                title: "The Art of Testing",
                source: "Journal of Tests"
            }
        ]
    };

    // Mock implementation of findFirst
    (prisma.project.findFirst as any).mockResolvedValue(mockProject);

    try {
        const result = await PublicationExportService.exportPublicationReady(
            "test-proj-123",
            "user-123",
            {
                format: "docx",
                citationStyle: "apa",
                includeCoverPage: false,
                coverPageStyle: "apa",
                includeTOC: false,
                performStructuralAudit: false
            }
        );

        const outputPath = path.join(__dirname, "test_output.docx");
        fs.writeFileSync(outputPath, result.buffer);
        console.log(`Export successful! Saved to ${outputPath}`);
        console.log("File size:", result.fileSize);

        // We could unzip and check XML here, but for now manual open or just success is good step 1.
        // Ideally we check if document.xml contains w:hyperlink and w:bookmarkStart

    } catch (error) {
        console.error("Export failed:", error);
    }
}

testExport();
