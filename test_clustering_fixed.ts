import { CitationEngine } from "./src/services/citationEngine";
import { prisma } from "./src/lib/prisma";

async function testClustering() {
  console.log("Starting Citation Clustering Test...");

  const engine = new CitationEngine("apa");
  
  // Mock citations
  const mockCitations = [
    { id: "cite1", csl_data: { id: "cite1", type: "article-journal", author: [{ family: "Smith", given: "John" }], issued: { "date-parts": [["2020"]] }, title: "Smith Paper" } },
    { id: "cite2", csl_data: { id: "cite2", type: "article-journal", author: [{ family: "Johnson", given: "Alice" }], issued: { "date-parts": [["2021"]] }, title: "Johnson Paper" } },
    { id: "cite3", csl_data: { id: "cite3", type: "article-journal", author: [{ family: "Lee", given: "Bob" }], issued: { "date-parts": [["2022"]] }, title: "Lee Paper" } },
  ];

  // Mock document with a cluster
  const mockContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { text: "This is a statement " },
          { type: "citation", attrs: { citationId: "cite1" } },
          { type: "citation", attrs: { citationId: "cite2" } },
          { text: " and another statement " },
          { type: "citation", attrs: { citationId: "cite3" } },
          { text: "." }
        ]
      }
    ]
  };

  const mockProject = {
    id: "test-proj",
    content: mockContent,
    citations: mockCitations
  };

  console.log("Resolving project...");
  await engine.initialize();
  const resolved = await engine.resolveProject(mockProject as any);

  console.log("\n--- Occurrence Map ---");
  console.log("Map Size:", resolved.occurrenceMap.size);
  resolved.occurrenceMap.forEach((val, key) => {
    console.log(`Index ${key}: "${val}"`);
  });

  console.log("\n--- Bibliography ---");
  resolved.bibliography.forEach(entry => {
    console.log(`[${entry.id}]: ${entry.text}`);
  });

  // Expected for APA:
  // Index 0 (cite1): "(Smith, 2020; Johnson, 2021)"
  // Index 1 (cite2): ""
  // Index 2 (cite3): "(Lee, 2022)"
  
  const formatted0 = resolved.occurrenceMap.get(0);
  const isClustered = formatted0?.includes("Smith") && formatted0?.includes("Johnson") && formatted0?.includes(";");
  const isEmpty1 = resolved.occurrenceMap.get(1) === "";

  if (isClustered && isEmpty1) {
    console.log("\n✅ SUCCESS: Citations were correctly clustered!");
  } else {
    console.log("\n❌ FAILURE: Clustering logic did not work as expected.");
    process.exit(1);
  }
}

testClustering().catch(console.error);
