"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthorshipConfidenceService = void 0;
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
const authorshipEvidenceService_1 = require("./authorshipEvidenceService");
class AuthorshipConfidenceService {
    static async generateProjectReport(projectId, userId) {
        await authorshipEvidenceService_1.AuthorshipEvidenceService.rebuildContributions(projectId);
        const totals = await this.getEvidenceTotals(projectId, userId);
        const generatedAt = new Date().toISOString();
        const attributionConfidence = this.calculateAttributionConfidence(totals);
        const contributionConfidence = this.calculateContributionConfidence(totals);
        const collaborationClarity = this.calculateCollaborationClarity(totals);
        const evidenceCompleteness = this.calculateEvidenceCompleteness(totals);
        const aiAssistanceTransparency = this.calculateAITransparency(totals);
        const anomalyRisk = await this.calculateAnomalyRisk(projectId, userId);
        const overallReliability = this.calculateOverallReliability({
            attributionConfidence,
            contributionConfidence,
            collaborationClarity,
            evidenceCompleteness,
            aiAssistanceTransparency,
            anomalyRisk,
        });
        const report = {
            projectId,
            userId,
            generatedAt,
            attributionConfidence,
            contributionConfidence,
            collaborationClarity,
            evidenceCompleteness,
            aiAssistanceTransparency,
            anomalyRisk,
            overallReliability,
            limitations: this.buildLimitations(totals),
            evidenceSummary: {
                totalEvidence: totals.total,
                strongEvidence: totals.strong,
                mediumEvidence: totals.medium,
                weakEvidence: totals.weak,
                serverObservedEvidence: totals.serverObserved,
                aiAssistedEvidence: totals.aiAssisted,
                collaborationSessions: totals.collaborationSessions,
                anomalies: totals.anomalies,
            },
        };
        const saved = await prisma_1.prisma.authorshipConfidenceReport.create({
            data: {
                project_id: projectId,
                user_id: userId,
                report_json: report,
                attribution_confidence: attributionConfidence.score,
                contribution_confidence: contributionConfidence.score,
                collaboration_clarity: collaborationClarity.score,
                evidence_completeness: evidenceCompleteness.score,
                ai_transparency: aiAssistanceTransparency.score,
                anomaly_risk: anomalyRisk.score,
                overall_reliability: overallReliability.label,
                generated_at: new Date(generatedAt),
            },
        });
        logger_1.default.info("Authorship confidence report generated", {
            reportId: saved.id,
            projectId,
            userId,
            overallReliability: overallReliability.label,
        });
        return report;
    }
    static async getLatestReport(projectId, userId) {
        const report = await prisma_1.prisma.authorshipConfidenceReport.findFirst({
            where: { project_id: projectId, user_id: userId },
            orderBy: { generated_at: "desc" },
        });
        return report?.report_json;
    }
    static async getEvidenceTotals(projectId, userId) {
        const evidence = await prisma_1.prisma.authorshipEvidence.findMany({
            where: { project_id: projectId, user_id: userId },
            select: {
                id: true,
                strength: true,
                source: true,
                evidence_type: true,
                ai_assisted: true,
            },
        });
        const collaborationSessions = await prisma_1.prisma.authorshipCollaborationSession.count({
            where: { project_id: projectId, user_id: userId },
        });
        const anomalies = await prisma_1.prisma.authorshipAnomaly.count({
            where: { project_id: projectId, user_id: userId },
        });
        const contributors = await prisma_1.prisma.authorshipContribution.count({
            where: { project_id: projectId },
        });
        const totals = {
            total: evidence.length,
            strong: 0,
            medium: 0,
            weak: 0,
            serverObserved: 0,
            aiAssisted: 0,
            collaborationUpdates: 0,
            clientTelemetry: 0,
            documentSnapshots: 0,
            anomalies,
            collaborationSessions,
            contributors,
        };
        for (const item of evidence) {
            if (item.strength === "strong")
                totals.strong += 1;
            if (item.strength === "medium")
                totals.medium += 1;
            if (item.strength === "weak")
                totals.weak += 1;
            if (item.source === "hocuspocus" || item.evidence_type === "server_observed_edit") {
                totals.serverObserved += 1;
            }
            if (item.ai_assisted)
                totals.aiAssisted += 1;
            if (item.evidence_type === "collaboration_update")
                totals.collaborationUpdates += 1;
            if (item.evidence_type === "client_telemetry")
                totals.clientTelemetry += 1;
            if (item.evidence_type === "document_snapshot")
                totals.documentSnapshots += 1;
        }
        return totals;
    }
    static calculateAttributionConfidence(totals) {
        const strongRatio = totals.total > 0 ? totals.strong / totals.total : 0;
        const serverObservedRatio = totals.total > 0 ? totals.serverObserved / totals.total : 0;
        const sessionEvidence = Math.min(1, totals.collaborationSessions / 2);
        const score = this.clamp(Math.round((strongRatio * 45 + serverObservedRatio * 35 + sessionEvidence * 20) *
            this.volumeMultiplier(totals.total)));
        return {
            score,
            label: this.labelFromScore(score),
            confidenceInterval: [Math.max(0, score - 7), Math.min(100, score + 7)],
            evidenceCount: totals.serverObserved,
            rationale: [
                `${totals.serverObserved} server-observed edit evidence items`,
                `${totals.strong} strong evidence items out of ${totals.total}`,
                `${totals.collaborationSessions} authenticated collaboration session(s)`,
            ],
        };
    }
    static calculateContributionConfidence(totals) {
        const coverage = Math.min(1, totals.total / 50);
        const strongSignal = totals.total > 0 ? totals.strong / totals.total : 0;
        const score = this.clamp(Math.round((coverage * 55 + strongSignal * 45) * this.volumeMultiplier(totals.total)));
        return {
            score,
            label: this.labelFromScore(score),
            confidenceInterval: [Math.max(0, score - 8), Math.min(100, score + 8)],
            evidenceCount: totals.total,
            rationale: [
                `${totals.total} normalized contribution evidence items`,
                `${totals.contributors} contributor summary row(s)`,
                "Contribution confidence is based on normalized evidence, not raw client telemetry",
            ],
        };
    }
    static calculateCollaborationClarity(totals) {
        const collaborationRatio = totals.total > 0 ? totals.collaborationUpdates / totals.total : 0;
        const sessionScore = Math.min(1, totals.collaborationSessions / 2);
        const score = this.clamp(Math.round((sessionScore * 60 + collaborationRatio * 40) * this.volumeMultiplier(totals.total)));
        return {
            score,
            label: this.labelFromScore(score),
            confidenceInterval: [Math.max(0, score - 9), Math.min(100, score + 9)],
            evidenceCount: totals.collaborationUpdates,
            rationale: [
                `${totals.collaborationSessions} authenticated collaboration session(s)`,
                `${totals.collaborationUpdates} collaboration update evidence item(s)`,
                totals.collaborationSessions === 0
                    ? "No authenticated collaboration session was recorded for this user/project"
                    : "Server-side collaboration session metadata is present",
            ],
        };
    }
    static calculateEvidenceCompleteness(totals) {
        const strongMediumRatio = totals.total > 0 ? (totals.strong + totals.medium) / totals.total : 0;
        const volume = Math.min(1, totals.total / 75);
        const snapshotBonus = Math.min(0.15, totals.documentSnapshots * 0.05);
        const score = this.clamp(Math.round((strongMediumRatio * 65 + volume * 35 + snapshotBonus * 100) * this.volumeMultiplier(totals.total)));
        return {
            score,
            label: this.labelFromScore(score),
            confidenceInterval: [Math.max(0, score - 8), Math.min(100, score + 8)],
            evidenceCount: totals.total,
            rationale: [
                `${totals.strong + totals.medium} strong/medium evidence items`,
                `${totals.documentSnapshots} document snapshot evidence item(s)`,
                `${totals.weak} weak evidence item(s) retained only as context`,
            ],
        };
    }
    static calculateAITransparency(totals) {
        if (totals.total === 0) {
            return {
                score: 50,
                label: "Low",
                confidenceInterval: [35, 65],
                evidenceCount: 0,
                rationale: ["No evidence is available for this project/user yet"],
            };
        }
        const aiRatio = totals.aiAssisted / totals.total;
        const score = this.clamp(Math.round(50 + Math.abs(aiRatio - 0.5) * 100));
        return {
            score,
            label: this.labelFromScore(score),
            confidenceInterval: [Math.max(0, score - 10), Math.min(100, score + 10)],
            evidenceCount: totals.aiAssisted,
            rationale: [
                `${totals.aiAssisted} AI-assisted evidence item(s) recorded`,
                "AI transparency reflects whether AI usage was explicitly observed, not whether AI was used",
            ],
        };
    }
    static async calculateAnomalyRisk(projectId, userId) {
        const anomalies = await prisma_1.prisma.authorshipAnomaly.findMany({
            where: { project_id: projectId, user_id: userId },
            orderBy: { score: "desc" },
            take: 20,
        });
        const maxSeverityScore = anomalies.reduce((max, anomaly) => Math.max(max, Number(anomaly.score ?? 0)), 0);
        const highOrCritical = anomalies.filter((anomaly) => anomaly.severity === "high" || anomaly.severity === "critical").length;
        const score = this.clamp(Math.round(maxSeverityScore + highOrCritical * 8));
        const label = score >= 80 ? "Critical" : score >= 60 ? "High" : score >= 35 ? "Medium" : "Low";
        return {
            score,
            label,
            confidenceInterval: this.interval(score - 10, score + 10),
            flags: anomalies.map((anomaly) => ({
                type: String(anomaly.anomaly_type),
                severity: anomaly.severity,
                message: String(anomaly.message),
            })),
        };
    }
    static calculateOverallReliability(dimensions) {
        const mean = (dimensions.attributionConfidence.score +
            dimensions.contributionConfidence.score +
            dimensions.collaborationClarity.score +
            dimensions.evidenceCompleteness.score +
            dimensions.aiAssistanceTransparency.score +
            (100 - dimensions.anomalyRisk.score)) /
            6;
        const floor = Math.min(dimensions.attributionConfidence.score, dimensions.contributionConfidence.score, dimensions.evidenceCompleteness.score);
        const adjusted = Math.round(Math.min(mean, floor + 15));
        const label = this.labelFromScore(adjusted);
        return {
            label,
            score: adjusted,
            confidenceInterval: this.interval(adjusted - 12, adjusted + 12),
            rationale: [
                "Overall reliability is capped by the weakest core evidence dimension",
                "Anomaly risk reduces the combined reliability estimate",
                "This is a confidence estimate, not proof of human authorship",
            ],
        };
    }
    static buildLimitations(totals) {
        const limitations = [
            "This report measures platform-observed contribution evidence and confidence.",
            "It does not prove human authorship or determine academic intent.",
            "Client-side typing telemetry is treated as weak secondary evidence only.",
        ];
        if (totals.serverObserved === 0) {
            limitations.push("No server-observed edit evidence was available for this user/project.");
        }
        if (totals.collaborationSessions === 0) {
            limitations.push("No authenticated collaboration session metadata was recorded.");
        }
        if (totals.anomalies > 0) {
            limitations.push(`${totals.anomalies} anomaly finding(s) should be reviewed before relying on the report.`);
        }
        return limitations;
    }
    static volumeMultiplier(total) {
        if (total === 0)
            return 0;
        if (total < 5)
            return 0.55;
        if (total < 20)
            return 0.75;
        return 1;
    }
    static labelFromScore(score) {
        if (score >= 80)
            return "High";
        if (score >= 60)
            return "Medium";
        if (score >= 35)
            return "Low";
        return "Insufficient";
    }
    static clamp(value) {
        return Math.max(0, Math.min(100, value));
    }
    static interval(low, high) {
        return [this.clamp(Math.round(low)), this.clamp(Math.round(high))];
    }
}
exports.AuthorshipConfidenceService = AuthorshipConfidenceService;
