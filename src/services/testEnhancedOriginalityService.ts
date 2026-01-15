import { EnhancedOriginalityDetectionService } from "./enhancedOriginalityDetectionService";

// Test data for different document types
const testDocuments = {
  academicPaper: `Recent studies show that machine learning algorithms have significantly improved natural language processing capabilities. According to Smith et al. (2023), the accuracy of semantic similarity detection has increased by 35% over the past two years. Furthermore, research indicates that transformer-based models outperform traditional approaches in various linguistic tasks. Evidence suggests that academic writing requires proper citation and attribution to maintain integrity.`,

  commonPhrases: `In conclusion, the results demonstrate significant improvements. On the other hand, some limitations exist. For example, data collection faced challenges. In other words, the methodology required adjustments. As a result, future research should consider these factors.`,

  paraphrasedContent: `According to recent investigations, algorithms related to machine learning have considerably enhanced the abilities of processing natural language. Smith and colleagues (2023) indicate that the precision of identifying semantic similarities has grown by thirty-five percent during the last twenty-four months. Moreover, studies reveal that models based on transformers surpass conventional methods in multiple language-related operations. The findings suggest that scholarly writing necessitates appropriate referencing and acknowledgment to preserve academic honesty.`,

  originalContent: `Our innovative approach combines multiple strategies for optimal results. The methodology incorporates both quantitative and qualitative analysis techniques. Through systematic evaluation, we discovered new patterns in the data. These findings contribute to the growing body of knowledge in this field.`,
};

async function runEnhancedOriginalityTests() {
  console.log("🧪 Running Enhanced Originality Detection Tests...\n");

  // Test 1: Academic Paper Detection
  console.log("📝 Test 1: Academic Paper Analysis");
  try {
    // This would normally require a project ID and user ID in a real implementation
    const result1 =
      await EnhancedOriginalityDetectionService.calculateEnhancedSimilarity(
        testDocuments.academicPaper,
        testDocuments.paraphrasedContent
      );
    console.log(`   Similarity Score: ${(result1 * 100).toFixed(2)}%`);
    console.log(
      `   Classification: ${result1 > 0.6 ? "High Similarity Detected" : "Acceptable Originality"}`
    );
  } catch (error) {
    console.log(`   Error: ${(error as Error).message}`);
  }
  console.log();

  // Test 2: Common Phrases Detection
  console.log("📝 Test 2: Common Phrases Analysis");
  try {
    const result2 =
      await EnhancedOriginalityDetectionService.calculateEnhancedSimilarity(
        testDocuments.commonPhrases,
        "In conclusion, the findings show important results. On the other hand, some issues remain. For example, collection had problems. In other words, the approach needed changes. As a result, future studies should consider these elements."
      );
    console.log(`   Similarity Score: ${(result2 * 100).toFixed(2)}%`);
    console.log(`   This demonstrates detection of common academic phrases`);
  } catch (error) {
    console.log(`   Error: ${(error as Error).message}`);
  }
  console.log();

  // Test 3: N-gram Similarity
  console.log("🔍 Test 3: N-gram Similarity Analysis");
  try {
    const ngramScore = EnhancedOriginalityDetectionService[
      "calculateNGramSimilarity"
    ](
      "Machine learning algorithms improve processing",
      "Deep learning models enhance computation"
    );
    console.log(
      `   N-gram Similarity Score: ${(ngramScore * 100).toFixed(2)}%`
    );
    console.log(`   This measures structural text similarity`);
  } catch (error) {
    console.log(`   Error: ${(error as Error).message}`);
  }
  console.log();

  // Test 4: Jaccard Similarity
  console.log("🔍 Test 4: Jaccard Similarity Analysis");
  try {
    const jaccardScore = EnhancedOriginalityDetectionService[
      "calculateJaccardSimilarity"
    ](
      "natural language processing artificial intelligence",
      "artificial intelligence machine learning"
    );
    console.log(
      `   Jaccard Similarity Score: ${(jaccardScore * 100).toFixed(2)}%`
    );
    console.log(`   This measures vocabulary overlap`);
  } catch (error) {
    console.log(`   Error: ${(error as Error).message}`);
  }
  console.log();

  // Test 5: Academic Language Detection
  console.log("🧠 Test 5: Academic Language Detection");
  try {
    const isAcademic1 = EnhancedOriginalityDetectionService[
      "isAcademicLanguage"
    ](
      "Furthermore, the evidence suggests significant implications for future research."
    );
    const isAcademic2 = EnhancedOriginalityDetectionService[
      "isAcademicLanguage"
    ]("The cat sat on the mat and looked around.");
    console.log(`   Academic sentence detected: ${isAcademic1}`);
    console.log(`   Non-academic sentence detected: ${!isAcademic2}`);
  } catch (error) {
    console.log(`   Error: ${(error as Error).message}`);
  }
  console.log();

  // Test 6: Passive Voice Detection
  console.log("🗣️ Test 6: Passive Voice Detection");
  try {
    const hasPassive1 = EnhancedOriginalityDetectionService["hasPassiveVoice"](
      "The experiment was conducted by the researchers."
    );
    const hasPassive2 = EnhancedOriginalityDetectionService["hasPassiveVoice"](
      "Researchers conducted the experiment."
    );
    console.log(`   Passive voice detected: ${hasPassive1}`);
    console.log(`   Active voice detected: ${!hasPassive2}`);
  } catch (error) {
    console.log(`   Error: ${(error as Error).message}`);
  }
  console.log();

  // Test 7: Classification Test
  console.log("🏷️ Test 7: Enhanced Classification Test");
  try {
    const classification = EnhancedOriginalityDetectionService["classifyMatch"](
      65, // similarity score
      "According to recent studies, the methodology shows significant improvements.",
      "academic"
    );
    console.log(`   Classification result: ${classification}`);
    console.log(`   This demonstrates context-aware classification`);
  } catch (error) {
    console.log(`   Error: ${(error as Error).message}`);
  }
  console.log();

  console.log("✅ All enhanced originality detection tests completed!");
  console.log("\n📈 Summary of Enhancements:");
  console.log(
    "   • Multi-database academic source integration (CrossRef, Semantic Scholar, arXiv, IEEE, PubMed)"
  );
  console.log(
    "   • Advanced NLP with multiple similarity algorithms (semantic, n-gram, Jaccard)"
  );
  console.log(
    "   • Context-aware classification with linguistic feature analysis"
  );
  console.log("   • Academic language and passive voice detection");
  console.log("   • Enhanced confidence scoring based on multiple factors");
  console.log("   • Improved thresholds for academic content differentiation");
}

// Run the tests
runEnhancedOriginalityTests().catch(console.error);
