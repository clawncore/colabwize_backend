import { CitationEngine } from "./src/services/citationEngine";

async function testBibliographyFiltering() {
  console.log("Starting Bibliography Filtering Test...");

  const engine = new CitationEngine("apa");
  
  // Mock citations - cite1 and cite2 are in project, but only cite1 is in document
  const mockCitations = [
    { id: "cite1", type: "article-journal", author: [{ family: "Smith", given: "John" }], issued: { "date-parts": [["2020"]] }, title: "Cited Paper" },
    { id: "cite2", type: "article-journal", author: [{ family: "Johnson", given: "Alice" }], issued: { "date-parts": [["2021"]] }, title: "Uncited Paper" },
  ];

  // Mock document with only cite1
  const mockContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { text: "This is a statement " },
          { type: "citation", attrs: { citationId: "cite1" } },
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

  // Pre-load all citations into engine items (simulating how ExportService does it)
  mockCitations.forEach(c => engine.getItem(c.id)); // This won't work easily since items map is private, 
  // but CitationEngine constructor handles it if passed as first arg.
  
  const engineWithItems = new CitationEngine(mockCitations, "apa");
  await engineWithItems.initialize();

  console.log("Resolving project...");
  const resolved = await engineWithItems.resolveProject(mockProject.content);

  console.log("\n--- Bibliography Debug ---");
  resolved.bibliography.forEach(entry => {
    console.log(`ID: "${entry.id}", Type: ${typeof entry.id}, Text Length: ${entry.text.length}`);
  });

  const hasCite1 = resolved.bibliography.some(e => String(e.id).trim() === "cite1");
  const hasCite2 = resolved.bibliography.some(e => String(e.id).trim() === "cite2");

  if (hasCite1 && !hasCite2) {
    console.log("\n✅ SUCCESS: Only cited references were included in the bibliography.");
  } else {
    console.log("\n❌ FAILURE: Bibliography filtering failed.");
    console.log(`Has Cite1: ${hasCite1}, Has Cite2: ${hasCite2}`);
    process.exit(1);
  }
}

testBibliographyFiltering().catch(console.error);
