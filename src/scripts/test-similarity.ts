import { OriginalityMapService } from "../services/originalityMapService";

async function runTest() {
  console.log("Testing Similarity Analysis Stack...");

  const testCases = [
    {
      text1: "The quick brown fox jumps over the lazy dog.",
      text2: "The quick brown fox jumps over the lazy dog.",
      description: "Exact Match",
      expectedType: "String Similarity",
    },
    {
      text1: "The quick brown fox jumps over the lazy dog.",
      text2: "A fast brown fox leaps over a lazy hound.",
      description: "Semantic Paraphrase",
      expectedType: "Cosine Similarity",
    },
    {
      text1: "The quick brown fox jumps over the lazy dog.",
      text2: "Quantum mechanics dictates the behavior of subatomic particles.",
      description: "No Similarity",
      expectedType: "Low Score",
    },
  ];

  for (const test of testCases) {
    console.log(`\n--- Test: ${test.description} ---`);
    console.log(`Text 1: "${test.text1}"`);
    console.log(`Text 2: "${test.text2}"`);

    const start = Date.now();
    const score = await OriginalityMapService.calculateSimilarity(
      test.text1,
      test.text2
    );
    const duration = Date.now() - start;

    console.log(`Score: ${(score * 100).toFixed(2)}%`);
    console.log(`Time: ${duration}ms`);

    if (test.description === "Exact Match" && score > 0.9) {
      console.log("✅ PASS: High score detected.");
    } else if (test.description === "Semantic Paraphrase" && score > 0.6) {
      console.log(
        "✅ PASS: Semantic match detected (likely via Transformers)."
      );
    } else if (test.description === "No Similarity" && score < 0.2) {
      console.log("✅ PASS: Low similarity correctly identified.");
    } else {
      console.log("❌ FAIL: Score expectations not met.");
    }
  }
}

runTest().catch(console.error);
