"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScoreStage = void 0;
/**
 * Stage: Score Finalization
 * Clamps the deeply calculated penalty score between 0 and 100
 * and formalizes the summary readiness.
 */
exports.ScoreStage = {
    name: "SCORE_GENERATION",
    weight: 5,
    execute: async (job, context) => {
        // Use Integrity Index as the baseline if it exists
        let finalScore = job.report.integrityIndex ?? job.report.summary.complianceScore;
        // Clamp
        if (finalScore < 0)
            finalScore = 0;
        if (finalScore > 100)
            finalScore = 100;
        job.report.summary.complianceScore = finalScore;
        job.report.integrityIndex = finalScore;
        console.log(`[Stage] SCORE_GENERATION: Final Compliance Score calculated at ${finalScore}/100.`);
    }
};
