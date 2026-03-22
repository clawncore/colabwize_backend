
import { CitationEngine } from '../src/services/citationEngine';
import { CitationCacheManager } from '../src/services/citationCacheManager';

const mockItems = [
    { id: 'ref_1', type: 'article-journal', title: 'Cache Test 1', author: [{ family: 'Speed', given: 'John' }], issued: { 'date-parts': [[2024]] } },
    { id: 'ref_2', type: 'book', title: 'Performance Optimization', author: [{ family: 'Fast', given: 'Alice' }], issued: { 'date-parts': [[2025]] } }
];

async function runTest() {
    console.log("--- Starting Cache Test ---");
    const engine = new CitationEngine(mockItems, 'apa');
    await engine.initialize();

    const clusters = [['ref_1'], ['ref_2'], ['ref_1', 'ref_2']];

    // 1. First Run (Cold)
    console.log("\n1. First Run (Cold)");
    const start1 = performance.now();
    const res1 = engine.formatCitations(clusters);
    const end1 = performance.now();
    console.log("Result 1:", res1[0]);
    console.log(`Time: ${(end1 - start1).toFixed(2)}ms`);

    // 2. Second Run (Warm)
    console.log("\n2. Second Run (Warm)");
    const start2 = performance.now();
    const res2 = engine.formatCitations(clusters);
    const end2 = performance.now();
    console.log("Result 2:", res2[0]);
    console.log(`Time: ${(end2 - start2).toFixed(2)}ms`);

    if (end2 - start2 < 1.0) { // Should be super fast
        console.log("✅ Cache Hit Verified (Fast execution)");
    } else {
        console.log("❓ Execution was not instant, check logs.");
    }

    // 3. Changed Input (New Item State)
    console.log("\n3. Changed Input (Modified Item)");
    // To simulate change, we need a new Engine instance OR update the engine items?
    // Engine maintains internal map. We can hack it or pass different inputs if we controlled the cache key generation externally.
    // The engine's cache key depends on `this.items`.
    // Let's create a new engine with modified item to see if cache hash changes.

    mockItems[0].title = "Modified Title";
    const engine2 = new CitationEngine(mockItems, 'apa');
    await engine2.initialize(); // Re-init

    const start3 = performance.now();
    const res3 = engine2.formatCitations(clusters);
    const end3 = performance.now();
    console.log("Result 3:", res3[0]); // Should reflect new title if citations include title (APA usually doesn't for inline, but bibliography does)
    console.log(`Time: ${(end3 - start3).toFixed(2)}ms`);

    // In APA inline, title change might not change the output text "(Speed, 2024)".
    // BUT the item content hash changed, so the cache key SHOULD change.
    // So it should be a "Miss" and run CSL again.
    // Log output "Running CSL Processing" will confirm.

    // 4. Bibliography Cache
    console.log("\n4. Bibliography Cache");
    const bib1 = engine.generateBibliography();
    console.log("Bib 1 generated.");
    const bib2 = engine.generateBibliography(); // Should be cached
    console.log("Bib 2 generated.");
}

runTest();
