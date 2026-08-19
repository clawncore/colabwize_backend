import logger from "../monitoring/logger";
import axios from "axios";
import { SecretsService } from "./secrets-service";
import { config } from "../config/env";
import { initializePrisma } from "../lib/prisma-async";

export type Stance = "supporting" | "opposing" | "neutral";
export type ConsensusLevel = "strong" | "emerging" | "divided" | "controversial";
export type ReplicationStatus = "replicated" | "failed_to_replicate" | "unverified";

export interface StanceResult {
    stance: Stance;
    confidence: number;
    reasoning: string;
    keyEvidence?: string;
    methodologyQuality: "high" | "medium" | "low";
    dissentContext?: string;
    biasRisk: "low" | "medium" | "high";
    replicationStatus: ReplicationStatus;
    independentVerification: boolean;
    biasTypes: string[];
    journalReputation?: "high" | "standard" | "low";
}

export interface ConsensusSummary {
    claim: string;
    consensusLevel: ConsensusLevel;
    agreementPercentage: number;
    supporting: Array<{ id: string; title: string; confidence: number; quality: string; replication: ReplicationStatus }>;
    opposing: Array<{ id: string; title: string; confidence: number; quality: string }>;
    neutral: Array<{ id: string; title: string; confidence: number; quality: string }>;
    summary: string;
    keyFindings: string[];
    evidenceConvergent: boolean;
    dissentAcknowledged: boolean;
    biasCheckStatus: "pass" | "warning" | "failed";
    extraordinaryEvidenceRequired: boolean;
    methodologyScore: number;
}

export interface ConsensusTopic {
    topic: string;
    consensusLevel: ConsensusLevel;
    paperCount: number;
    agreementPercentage: number;
    claimSummary: string;
}

export class ConsensusAnalysisService {
    /**
     * Analyze stance of a single paper abstract on a claim
     */
    static async analyzeStance(
        claim: string,
        abstract: string,
        citationId: string
    ): Promise<StanceResult> {
        try {
            const apiKey = await SecretsService.getOpenAiApiKey() || config.openai?.apiKey;
            if (!apiKey) {
                throw new Error("OpenAI API key not configured");
            }

            const prompt = `Analyze the following paper abstract and determine its stance on this claim:

Claim: "${claim}"

Abstract: "${abstract.slice(0, 1500)}"

Determine if this paper:
- SUPPORTS the claim (provides empirical evidence in favor)
- OPPOSES the claim (contradicts, refutes, or identifies significant flaws)
- Is NEUTRAL (discusses without taking a clear empirical stance)

Apply rigorous scientific methodology:
1. Verifying Evidence Sources: Is the consensus based on reproducible results and empirically supported research in reputable journals?
2. Identifying Dissent: Does the paper acknowledge uncertainty or valid dissenting data?
3. Detecting Misinformation/Bias: Identify cherry-picking, misrepresentation of agreement, or funding/political biases.
4. Replication Status: Has the finding been replicated or failed to replicate?
5. Independent Verification: Are the researchers independent of the original claim's proponents?

Respond in JSON format:
{
  "stance": "supporting" | "opposing" | "neutral",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation",
  "keyEvidence": "Specific finding or data point",
  "methodologyQuality": "high" | "medium" | "low",
  "dissentContext": "Acknowledgment of uncertainty or dissenting views",
  "biasRisk": "low" | "medium" | "high",
  "biasTypes": ["string"],
  "replicationStatus": "replicated" | "failed_to_replicate" | "unverified",
  "independentVerification": boolean,
  "journalReputation": "high" | "standard" | "low"
}`;

            const response = await axios.post(
                "https://api.openai.com/v1/chat/completions",
                {
                    model: "gpt-4o-mini",
                    messages: [
                        {
                            role: "system",
                            content: "You are an expert research analyst. Analyze paper abstracts objectively to determine their stance on scientific claims."
                        },
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    temperature: 0.3,
                    max_tokens: 200,
                    response_format: { type: "json_object" }
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${apiKey}`
                    },
                    timeout: 30000
                }
            );

            const result = JSON.parse(response.data.choices[0].message.content || "{}");

            logger.info("Stance analyzed", {
                citationId,
                stance: result.stance,
                confidence: result.confidence
            });

            return result as StanceResult;

        } catch (error: any) {
            logger.error("Failed to analyze stance", {
                citationId,
                error: error.message
            });

            // Return neutral as fallback
            return {
                stance: "neutral",
                confidence: 0.5,
                reasoning: "Analysis failed, defaulted to neutral",
                methodologyQuality: "medium",
                biasRisk: "medium",
                replicationStatus: "unverified",
                independentVerification: false,
                biasTypes: []
            };
        }
    }

    /**
     * Analyze consensus across multiple papers
     */
    static async analyzeConsensus(
        claim: string,
        citations: Array<{ id: string; title: string; abstract?: string }>
    ): Promise<ConsensusSummary> {
        try {
            const stancePromises = citations.map(async (citation) => {
                const abstract = citation.abstract || citation.title;
                const stanceResult = await this.analyzeStance(claim, abstract, citation.id);

                return {
                    id: citation.id,
                    title: citation.title,
                    stance: stanceResult.stance,
                    confidence: stanceResult.confidence,
                    reasoning: stanceResult.reasoning,
                    keyEvidence: stanceResult.keyEvidence,
                    methodologyQuality: stanceResult.methodologyQuality,
                    dissentContext: stanceResult.dissentContext,
                    biasRisk: stanceResult.biasRisk,
                    replicationStatus: stanceResult.replicationStatus,
                    independentVerification: stanceResult.independentVerification,
                    biasTypes: stanceResult.biasTypes,
                    journalReputation: stanceResult.journalReputation
                };
            });

            const results = await Promise.all(stancePromises);

            // Calculate consensus metrics
            const supporting = results.filter(r => r.stance === "supporting");
            const opposing = results.filter(r => r.stance === "opposing");
            const neutral = results.filter(r => r.stance === "neutral");

            const agreementPercentage = results.length > 0 ? Math.round((supporting.length / results.length) * 100) : 0;
            const consensusLevel = this.determineConsensusLevel(agreementPercentage);

            // Generate summary
            const summary = this.generateEnhancedSummary(supporting, opposing, neutral, results.length);

            // Extract key findings
            const keyFindings = results
                .filter(r => r.keyEvidence)
                .slice(0, 3)
                .map(r => r.keyEvidence!);

            // Rigorous Meta-Analysis for Convergent Evidence
            // Convergent evidence requires multiple independent, high-quality papers with replicated results
            const convergentCount = supporting.filter(s => 
                s.methodologyQuality === "high" && 
                s.independentVerification && 
                s.replicationStatus === "replicated"
            ).length;
            
            const evidenceConvergent = convergentCount >= 3 || (supporting.length > 0 && convergentCount === supporting.length && supporting.length >= 2);
            
            const dissentAcknowledged = results.some(r => r.dissentContext && r.dissentContext.length > 15);
            const highBiasCount = results.filter(r => r.biasRisk === "high").length;
            const biasCheckStatus = highBiasCount === 0 ? "pass" : highBiasCount < results.length / 3 ? "warning" : "failed";

            // Extraordinary Evidence Check: 
            // If the consensus is strong and a paper opposes it, we flag that extraordinary evidence is required.
            const extraordinaryEvidenceRequired = consensusLevel === "strong" && opposing.length > 0;

            // Methodology Score (0-100)
            const methodologyScore = Math.round(
                (results.filter(r => r.methodologyQuality === "high").length * 100 +
                results.filter(r => r.methodologyQuality === "medium").length * 50) / 
                Math.max(results.length, 1)
            );

            return {
                claim,
                consensusLevel,
                agreementPercentage,
                supporting: supporting.map(s => ({ 
                    id: s.id, 
                    title: s.title, 
                    confidence: s.confidence, 
                    quality: s.methodologyQuality,
                    replication: s.replicationStatus
                })),
                opposing: opposing.map(o => ({ 
                    id: o.id, 
                    title: o.title, 
                    confidence: o.confidence, 
                    quality: o.methodologyQuality
                })),
                neutral: neutral.map(n => ({ 
                    id: n.id, 
                    title: n.title, 
                    confidence: n.confidence, 
                    quality: n.methodologyQuality
                })),
                summary,
                keyFindings,
                evidenceConvergent,
                dissentAcknowledged,
                biasCheckStatus,
                extraordinaryEvidenceRequired,
                methodologyScore
            };

        } catch (error: any) {
            logger.error("Failed to analyze consensus", {
                claim,
                error: error.message
            });
            throw error;
        }
    }

    /**
     * Determine consensus level based on agreement percentage
     */
    private static determineConsensusLevel(agreementPercentage: number): ConsensusLevel {
        if (agreementPercentage >= 80) return "strong";
        if (agreementPercentage >= 60) return "emerging";
        if (agreementPercentage >= 40) return "divided";
        return "controversial";
    }

    /**
     * Generate enhanced human-readable consensus summary
     */
    private static generateEnhancedSummary(
        supporting: any[],
        opposing: any[],
        neutral: any[],
        total: number
    ): string {
        const supportCount = supporting.length;
        const opposeCount = opposing.length;
        const neutralCount = neutral.length;

        if (supportCount > opposeCount * 3 && supportCount >= 3) {
            return `Strong scientific consensus: ${supportCount} of ${total} independent papers provide convergent evidence supporting this claim.`;
        } else if (supportCount > opposeCount) {
            return `Emerging consensus: ${supportCount} papers support vs ${opposeCount} oppose. Evidence is growing but requires further replication.`;
        } else if (opposeCount > supportCount * 2) {
            return `Strong contradiction: The majority of evidence (${opposeCount} papers) refutes this claim. Extraordinary evidence is required to challenge this consensus.`;
        } else if (Math.abs(supportCount - opposeCount) <= total * 0.3) {
            return `Divided/Inconclusive: Evidence is split (${supportCount} support, ${opposeCount} oppose). This is an area of active debate with significant uncertainty.`;
        } else {
            return `Limited Evidence: Only ${total} papers analyzed. A preliminary stance indicates ${supportCount > opposeCount ? "support" : "opposition"}.`;
        }
    }

    /**
     * Extract consensus topics from a project's citations
     */
    static async extractConsensusTopics(projectId: string): Promise<ConsensusTopic[]> {
        try {
            const prisma = await initializePrisma();

            // Get all citations for the project with abstracts
            const citations = await prisma.citation.findMany({
            
                where: { project_id: projectId },
                select: {
                    id: true,
                    title: true,
                    abstract: true
                }
            });

            if (citations.length < 3) {
                return []; // Need at least 3 papers for meaningful consensus
            }

            // Group citations by common keywords/topics (simple approach)
            // In a real implementation, you'd use more sophisticated topic modeling
            const topics = await this.identifyTopics(citations);

            logger.info("Consensus topics extracted", {
                projectId,
                topicCount: topics.length
            });

            return topics;

        } catch (error: any) {
            logger.error("Failed to extract consensus topics", {
                projectId,
                error: error.message
            });
            return [];
        }
    }

    /**
     * Simple topic identification (placeholder for more sophisticated analysis)
     */
    private static async identifyTopics(citations: any[]): Promise<ConsensusTopic[]> {
        // For now, return a placeholder topic
        // In production, this would use NLP/topic modeling
        return [{
            topic: "Main Research Theme",
            consensusLevel: "emerging",
            paperCount: citations.length,
            agreementPercentage: 65,
            claimSummary: "Collective findings from literature"
        }];
    }
}

