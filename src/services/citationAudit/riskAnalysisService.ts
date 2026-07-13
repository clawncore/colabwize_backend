import logger from "../../monitoring/logger";

export interface RiskAnalysisResult {
    hasRisk: boolean;
    riskFactors: MockRiskFactor[];
}

interface MockRiskFactor {
    type: "FUNDING_BIAS" | "RETRACTED" | "PREDATORY_JOURNAL" | "HIGH_STAKES_TOPIC";
    description: string;
    severity: "HIGH" | "MEDIUM" | "LOW";
}

/**
 * Tier 3: Risk & Bias Audit Service
 * 
 * Analyses content for high-stakes domains (Medical, Policy) and checks for
 * risk signals like funding bias or retracted papers.
 */
export class RiskAnalysisService {

    // Keywords that trigger Tier 3 analysis
    private static readonly RISK_TRIGGERS = [
        "clinical trial",
        "vaccine",
        "policy recommendation",
        "public health",
        "treatment efficacy",
        "adverse effects",
        "funding provided by",
        "conflict of interest"
    ];

    /**
     * Check if the document content warrants a Tier 3 Risk Audit
     */
    static shouldRunRiskAudit(fullText: string): boolean {
        const textLower = fullText.toLowerCase();
        return this.RISK_TRIGGERS.some(trigger => textLower.includes(trigger));
    }

    /**
     * Run the Risk Analysis (Tier 3)
     * currently simulated / heuristic-based until external provider integration.
     */
    static async analyzeRisks(
        citations: { text: string; context?: string }[]
    ): Promise<RiskAnalysisResult> {
        const detectedRisks: MockRiskFactor[] = [];

        for (const citation of citations) {
            const contextLower = (citation.context || "").toLowerCase();
            const textLower = citation.text.toLowerCase();

            // Heuristic 1: Funding Bias detection in context
            if (contextLower.includes("funded by") || contextLower.includes("sponsored by")) {
                // If the sponsor is a commercial entity in a high stakes field (simplified heuristic)
                if (contextLower.includes("pharma") || contextLower.includes("corporation") || contextLower.includes("industry")) {
                    detectedRisks.push({
                        type: "FUNDING_BIAS",
                        description: `Potential funding bias detected in citation context: "${citation.context?.substring(0, 50)}..."`,
                        severity: "MEDIUM"
                    });
                }
            }

            // Heuristic 2: High Stakes Topic (Medical)
            if (contextLower.includes("treatment") || contextLower.includes("efficacy") || contextLower.includes("cure")) {
                // Logic to verify if the source is high quality required here. 
                // For now, we just flag that this is a high stakes claim being made.
                // We don't flag "High Stakes" as a violation, but we might want to ensure it has a DOI.
            }
        }

        return {
            hasRisk: detectedRisks.length > 0,
            riskFactors: detectedRisks
        };
    }
}
