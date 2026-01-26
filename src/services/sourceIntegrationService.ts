import { prisma } from "../lib/prisma";
import logger from "../monitoring/logger";

export interface SourceReadingData {
    sourceId: string;
    projectId: string;
    userId: string;
    sourceTitle?: string;
    timeSpentReading: number; // milliseconds
    citationAddedTime?: number; // timestamp
}

export interface SourceIntegrationReport {
    redFlags: Array<{
        sourceId: string;
        flagType: 'citation_without_reading' | 'insufficient_reading_time' | 'no_annotations';
        message: string;
    }>;
    readingAuditTrail: Array<{
        sourceId: string;
        sourceTitle?: string;
        timeSpent: number;
        openCount: number;
        citationTiming: string;
    }>;
    authenticityScore: number;
    isConsistentWithReading: boolean;
}

export class SourceIntegrationService {
    /**
     * Track a source interaction (opening, reading time)
     */
    static async trackSourceInteraction(data: SourceReadingData): Promise<void> {
        try {
            const { sourceId, projectId, userId, sourceTitle, timeSpentReading, citationAddedTime } = data;

            // Check if this source interaction already exists
            const existing = await prisma.sourceInteraction.findUnique({
                where: {
                    project_id_user_id_source_id: {
                        project_id: projectId,
                        user_id: userId,
                        source_id: sourceId,
                    },
                },
            });

            if (existing) {
                // Update existing interaction
                await prisma.sourceInteraction.update({
                    where: { id: existing.id },
                    data: {
                        total_reading_time_ms: existing.total_reading_time_ms + timeSpentReading,
                        open_count: existing.open_count + 1,
                        last_read_at: new Date(),
                        citation_added_at: citationAddedTime ? new Date(citationAddedTime) : existing.citation_added_at,
                        is_cited: citationAddedTime ? true : existing.is_cited,
                    },
                });
            } else {
                // Create new interaction
                await prisma.sourceInteraction.create({
                    data: {
                        project_id: projectId,
                        user_id: userId,
                        source_id: sourceId,
                        source_title: sourceTitle,
                        total_reading_time_ms: timeSpentReading,
                        open_count: 1,
                        first_read_at: new Date(),
                        last_read_at: new Date(),
                        citation_added_at: citationAddedTime ? new Date(citationAddedTime) : null,
                        is_cited: !!citationAddedTime,
                        citation_preceded_by_reading: !citationAddedTime, // If citation added immediately, mark as suspicious
                    },
                });
            }

            logger.info("Source interaction tracked", { sourceId, projectId, userId });
        } catch (error: any) {
            logger.error("Error tracking source interaction", { error: error.message });
            throw error;
        }
    }

    /**
     * Mark a citation as added for a source
     */
    static async markCitationAdded(
        projectId: string,
        userId: string,
        sourceId: string
    ): Promise<void> {
        try {
            const interaction = await prisma.sourceInteraction.findUnique({
                where: {
                    project_id_user_id_source_id: {
                        project_id: projectId,
                        user_id: userId,
                        source_id: sourceId,
                    },
                },
            });

            if (interaction) {
                // Citation was added after reading
                const timeSinceFirstRead = Date.now() - interaction.first_read_at.getTime();
                const citationPrecededByReading = timeSinceFirstRead > 30000; // 30 seconds threshold

                await prisma.sourceInteraction.update({
                    where: { id: interaction.id },
                    data: {
                        is_cited: true,
                        citation_added_at: new Date(),
                        citation_preceded_by_reading: citationPrecededByReading,
                    },
                });
            } else {
                // Citation added without any reading activity - RED FLAG
                await prisma.sourceInteraction.create({
                    data: {
                        project_id: projectId,
                        user_id: userId,
                        source_id: sourceId,
                        total_reading_time_ms: 0,
                        open_count: 0,
                        is_cited: true,
                        citation_added_at: new Date(),
                        citation_preceded_by_reading: false,
                    },
                });
            }

            logger.info("Citation marked for source", { sourceId, projectId, userId });
        } catch (error: any) {
            logger.error("Error marking citation", { error: error.message });
            throw error;
        }
    }

    /**
     * Verify source integration and generate report
     */
    static async verifySourceIntegration(projectId: string, userId: string): Promise<SourceIntegrationReport> {
        try {
            const interactions = await prisma.sourceInteraction.findMany({
                where: {
                    project_id: projectId,
                    user_id: userId,
                },
            });

            const redFlags: SourceIntegrationReport['redFlags'] = [];
            const readingAuditTrail: SourceIntegrationReport['readingAuditTrail'] = [];

            interactions.forEach((interaction) => {
                // Build audit trail
                readingAuditTrail.push({
                    sourceId: interaction.source_id,
                    sourceTitle: interaction.source_title || undefined,
                    timeSpent: interaction.total_reading_time_ms,
                    openCount: interaction.open_count,
                    citationTiming: interaction.citation_preceded_by_reading ? 'after' : 'before',
                });

                // Check for red flags
                if (interaction.is_cited && !interaction.citation_preceded_by_reading) {
                    redFlags.push({
                        sourceId: interaction.source_id,
                        flagType: 'citation_without_reading',
                        message: `Citation added without reading source: ${interaction.source_title || interaction.source_id}`,
                    });
                }

                if (interaction.is_cited && interaction.total_reading_time_ms < 30000) {
                    redFlags.push({
                        sourceId: interaction.source_id,
                        flagType: 'insufficient_reading_time',
                        message: `Source opened for less than 30 seconds: ${interaction.source_title || interaction.source_id}`,
                    });
                }
            });

            // Calculate authenticity score
            const totalSources = interactions.length;
            const sourcesWithAdequateReading = interactions.filter(
                (i) => i.total_reading_time_ms >= 30000
            ).length;
            const sourcesWithProperTiming = interactions.filter(
                (i) => i.citation_preceded_by_reading
            ).length;

            const authenticityScore = totalSources > 0
                ? Math.round(((sourcesWithAdequateReading + sourcesWithProperTiming) / (totalSources * 2)) * 100)
                : 100;

            return {
                redFlags,
                readingAuditTrail,
                authenticityScore,
                isConsistentWithReading: redFlags.length === 0,
            };
        } catch (error: any) {
            logger.error("Error verifying source integration", { error: error.message });
            throw error;
        }
    }

    /**
     * Get source analytics for a project
     */
    static async getSourceAnalytics(projectId: string, userId: string) {
        try {
            return await prisma.sourceInteraction.findMany({
                where: {
                    project_id: projectId,
                    user_id: userId,
                },
                orderBy: {
                    last_read_at: 'desc',
                },
            });
        } catch (error: any) {
            logger.error("Error getting source analytics", { error: error.message });
            throw error;
        }
    }
}
