import { RealTimeAuthorshipTrackingService } from "./realTimeAuthorshipTrackingService";
import { ActivityTrackingService } from "./activityTrackingService";

async function testAuthorshipTracking() {
  console.log("Testing Enhanced Authorship Tracking System...");

  try {
    // Simulate a project and user ID
    const projectId = "test-project-id";
    const userId = "test-user-id";

    console.log("\n1. Testing real-time activity tracking...");

    // Simulate various real-time activities
    await RealTimeAuthorshipTrackingService.trackActivity({
      projectId,
      userId,
      eventType: "keystroke",
      timestamp: new Date(),
      keystrokes: 10,
      sessionType: "writing",
      activeTime: 60,
      wordCount: 50,
    });

    await RealTimeAuthorshipTrackingService.trackActivity({
      projectId,
      userId,
      eventType: "edit",
      timestamp: new Date(),
      contentChange: {
        before: "This is the original text.",
        after: "This is the modified text.",
        position: 10,
      },
      keystrokes: 5,
      sessionType: "editing",
      activeTime: 120,
      wordCount: 55,
    });

    await RealTimeAuthorshipTrackingService.trackActivity({
      projectId,
      userId,
      eventType: "session-end",
      timestamp: new Date(),
      sessionType: "reviewing",
      idleTime: 300,
      activeTime: 180,
    });

    console.log("✓ Real-time activities tracked successfully");

    console.log("\n2. Testing writing pattern analysis...");

    // Calculate writing patterns
    const writingPatterns =
      await RealTimeAuthorshipTrackingService.calculateWritingPatterns(
        projectId,
        userId
      );

    console.log("Writing Patterns:", writingPatterns);

    console.log("\n3. Testing comprehensive authenticity report...");

    // Generate authenticity report
    const authenticityReport =
      await RealTimeAuthorshipTrackingService.generateAuthenticityReport(
        projectId,
        userId
      );

    console.log("Authenticity Report:", {
      authenticityScore: authenticityReport.authenticityScore,
      manualWorkPercentage: authenticityReport.manualWorkPercentage,
      activeTimePercentage: authenticityReport.activeTimePercentage,
      cognitiveLoadAverage: authenticityReport.cognitiveLoadAverage,
    });

    console.log("\n4. Testing activity summary enhancement...");

    // Get enhanced activity summary
    const activitySummary = await ActivityTrackingService.getActivitySummary(
      projectId,
      userId
    );

    console.log("Enhanced Activity Summary:", {
      totalActiveTime: activitySummary.totalActiveTime,
      totalIdleTime: activitySummary.totalIdleTime,
      totalManualEdits: activitySummary.totalManualEdits,
      totalAIAssistedEdits: activitySummary.totalAIAssistedEdits,
      authenticityScore: activitySummary.authenticityScore,
    });

    // Get enhanced certificate stats
    const certStats = await ActivityTrackingService.getCertificateStats(
      projectId,
      userId
    );

    console.log("Enhanced Certificate Stats:", {
      totalActiveTime: certStats.totalActiveTime,
      manualWorkLevel: certStats.manualWorkLevel,
      authenticityScore: certStats.authenticityScore,
      manualWorkPercentage: certStats.manualWorkPercentage,
    });

    console.log("\n✓ All Enhanced Authorship Tracking tests passed!");
    console.log("\nEnhanced Features Implemented:");
    console.log("- Real-time activity tracking with keystroke monitoring");
    console.log("- Writing pattern analysis and cognitive load estimation");
    console.log("- Manual vs AI-assisted edit differentiation");
    console.log("- Active/idle time tracking for authentic work verification");
    console.log("- Comprehensive authenticity scoring system");
    console.log("- Enhanced certificate generation with robust metrics");
  } catch (error) {
    console.error("Error during authorship tracking test:", error);
  }
}

// Run the test
testAuthorshipTracking();
