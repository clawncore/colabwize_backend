import logger from "../monitoring/logger";
import axios from "axios";
import { SecretsService } from "./secrets-service";
import { config } from "../config/env";
import { initializePrisma } from "../lib/prisma-async";

export type Stance = "supporting" | "opposing" | "neutral";
export type ConsensusLevel = "strong" | "emerging" | "divided" | "controversial";

export interface StanceResult {
    stance: Stance;
    confidence: number;
    reasoning: string;
    keyEvidence?: string;
}

export interface ConsensusSummary {
    claim: string;
    consensusLevel: ConsensusLevel;
    agreementPercentage: number;
    supporting: Array<{ id: string; title: string; confidence: number }>;
    opposing: Array<{ id: string; title: string; confidence: number }>;
    neutral: Array<{ id: string; title: string; confidence: number }>;
    summary: string;
    keyFindings: string[];
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

Abstract: "${abstract.slice(0, 1000)}"

Determine if this paper:
- SUPPORTS the claim (provides evidence in favor)
- OPPOSES the claim (contradicts or refutes it)
- Is NEUTRAL (discusses but doesn't take a clear stance)

Respond in JSON format:
{
  "stance": "supporting" | "opposing" | "neutral",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation",
  "keyEvidence": "Relevant quote or finding from abstract"
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
                reasoning: "Analysis failed, defaulted to neutral"
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
                    keyEvidence: stanceResult.keyEvidence
                };
            });

            const results = await Promise.all(stancePromises);

            // Calculate consensus
            const supporting = results.filter(r => r.stance === "supporting");
            const opposing = results.filter(r => r.stance === "opposing");
            const neutral = results.filter(r => r.stance === "neutral");

            const agreementPercentage = Math.round((supporting.length / results.length) * 100);
            const consensusLevel = this.determineConsensusLevel(agreementPercentage);

            // Generate summary
            const summary = this.generateConsensusSummary(supporting.length, opposing.length, neutral.length, results.length);

            // Extract key findings
            const keyFindings = results
                .filter(r => r.keyEvidence)
                .slice(0, 3)
                .map(r => r.keyEvidence!);

            return {
                claim,
                consensusLevel,
                agreementPercentage,
                supporting: supporting.map(s => ({ id: s.id, title: s.title, confidence: s.confidence })),
                opposing: opposing.map(o => ({ id: o.id, title: o.title, confidence: o.confidence })),
                neutral: neutral.map(n => ({ id: n.id, title: n.title, confidence: n.confidence })),
                summary,
                keyFindings
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
     * Generate human-readable consensus summary
     */
    private static generateConsensusSummary(
        supporting: number,
        opposing: number,
        neutral: number,
        total: number
    ): string {
        if (supporting > opposing * 2) {
            return `Strong agreement: ${supporting} of ${total} papers support this claim.`;
        } else if (supporting > opposing) {
            return `Emerging consensus: ${supporting} papers support vs ${opposing} oppose.`;
        } else if (Math.abs(supporting - opposing) <= total * 0.2) {
            return `Divided: ${supporting} support, ${opposing} oppose, ${neutral} neutral. No clear consensus.`;
        } else {
            return `Controversial: ${opposing} papers oppose vs ${supporting} support this claim.`;
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

