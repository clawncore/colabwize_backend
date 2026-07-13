"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthorshipEvidenceService = void 0;
const crypto_1 = require("crypto");
const prisma_1 = require("../lib/prisma");
const logger_1 = __importDefault(require("../monitoring/logger"));
class AuthorshipEvidenceService {
    static hashPayload(payload) {
        return (0, crypto_1.createHash)("sha256")
            .update(JSON.stringify(payload ?? {}))
            .digest("hex");
    }
    static async recordEvidenceBatch(input) {
        const normalizedEvidence = input.evidence.map((e) => this.normalizeEvidenceInput(input, e));
        if (normalizedEvidence.length === 0) {
            throw new Error("Authorship evidence batch must contain at least one evidence item");
        }
        const userId = normalizedEvidence[0].userId;
        if (normalizedEvidence.some((e) => e.userId !== userId || e.projectId !== input.projectId)) {
            throw new Error("Authorship evidence batch must contain evidence for one user and project");
        }
        const batch = await prisma_1.prisma.authorshipEvidenceBatch.create({
            data: {
                project_id: input.projectId,
                user_id: userId,
                session_id: input.sessionId,
                client_session_id: input.clientSessionId,
                source: input.source,
                evidence_count: normalizedEvidence.length,
                raw_payload: input.rawPayload ?? {},
                status: "received",
            },
        });
        await prisma_1.prisma.authorshipEvidence.createMany({
            data: normalizedEvidence.map((e) => ({
                project_id: e.projectId,
                user_id: e.userId,
                batch_id: batch.id,
                collaboration_session_id: e.collaborationSessionId,
                evidence_id: e.evidenceId,
                evidence_type: e.evidenceType,
                evidence_hash: e.evidenceHash,
                source: e.source,
                strength: e.strength,
                server_received_at: e.serverReceivedAt
                    ? new Date(e.serverReceivedAt)
                    : new Date(),
                event_timestamp: e.eventTimestamp ? new Date(e.eventTimestamp) : null,
                block_id: e.blockId?.trim() || "__document",
                section_title: e.sectionTitle,
                content_hash: e.contentHash,
                inserted_chars: e.insertedChars ?? 0,
                deleted_chars: e.deletedChars ?? 0,
                edit_count: e.editCount ?? (e.evidenceType === "server_observed_edit" ? 1 : 0),
                ai_assisted: e.aiAssisted ?? false,
                anomaly_score: e.anomalyScore ?? 0,
                payload: e.payload ?? {},
            })),
            skipDuplicates: true,
        });
        await prisma_1.prisma.authorshipEvidenceBatch.update({
            where: { id: batch.id },
            data: {
                status: "processed",
                processed_at: new Date(),
            },
        });
        await this.rebuildContributions(input.projectId);
        const evidenceIds = normalizedEvidence.map((e) => e.evidenceId);
        logger_1.default.info("Authorship evidence batch recorded", {
            batchId: batch.id,
            projectId: input.projectId,
            evidenceCount: evidenceIds.length,
        });
        return {
            batchId: batch.id,
            evidenceIds,
        };
    }
    static async recordWritingSessionSnapshot(input) {
        if (!input.userId) {
            throw new Error("Writing session snapshot must include a user id");
        }
        const sessionId = input.clientSessionId ?? `client-${this.hashPayload({ projectId: input.projectId, userId: input.userId })}`;
        const savedAt = input.savedAt ? new Date(input.savedAt) : new Date();
        const evidence = [
            {
                projectId: input.projectId,
                userId: input.userId,
                evidenceId: `ws-snapshot-${sessionId}-${this.hashPayload({ savedAt: savedAt.toISOString(), editCount: input.metrics?.editCount ?? 0 }).slice(0, 16)}`,
                evidenceType: "client_telemetry",
                source: "editor_api",
                strength: "weak",
                sessionId,
                clientSessionId: input.clientSessionId,
                eventTimestamp: input.savedAt,
                editCount: input.metrics?.editCount ?? input.sessions.reduce((total, session) => total + session.editCount, 0),
                payload: {
                    kind: "writing_session_snapshot",
                    initialContentHash: input.initialContentHash,
                    metrics: input.metrics ?? {},
                },
            },
        ];
        input.sessions.forEach((session, index) => {
            evidence.push({
                projectId: input.projectId,
                userId: input.userId,
                evidenceId: `ws-session-${sessionId}-${index}-${this.hashPayload(session).slice(0, 16)}`,
                evidenceType: "client_telemetry",
                source: "editor_api",
                strength: "weak",
                sessionId,
                clientSessionId: input.clientSessionId,
                eventTimestamp: session.startTime,
                editCount: session.editCount,
                payload: {
                    kind: "writing_session",
                    session,
                },
            });
        });
        input.copyPastes.forEach((copyPaste, index) => {
            evidence.push({
                projectId: input.projectId,
                userId: input.userId,
                evidenceId: `ws-paste-${sessionId}-${index}-${this.hashPayload(copyPaste).slice(0, 16)}`,
                evidenceType: "anomaly",
                source: "editor_api",
                strength: "weak",
                sessionId,
                clientSessionId: input.clientSessionId,
                eventTimestamp: new Date(copyPaste.time).toISOString(),
                editCount: copyPaste.copyPasteSourceEdits,
                insertedChars: copyPaste.copyPasteChars,
                anomalyScore: Math.min(100, 40 + copyPaste.copyPasteChars / 20),
                payload: {
                    kind: "copy_paste_finding",
                    copyPasteReason: copyPaste.copyPasteReason,
                    copyPasteChars: copyPaste.copyPasteChars,
                    copyPasteDurationMs: copyPaste.copyPasteDurationMs,
                    copyPasteSourceEdits: copyPaste.copyPasteSourceEdits,
                    snippetLength: copyPaste.text?.length ?? 0,
                },
            });
        });
        return this.recordEvidenceBatch({
            projectId: input.projectId,
            sessionId,
            clientSessionId: input.clientSessionId,
            source: "client_batch",
            rawPayload: {
                kind: "writing_session_snapshot",
                savedAt: savedAt.toISOString(),
                initialContentHash: input.initialContentHash,
                metrics: input.metrics ?? {},
                sessionCount: input.sessions.length,
                copyPasteCount: input.copyPastes.length,
            },
            evidence,
        });
    }
    static async recordServerObservedEdit(input) {
        const evidenceId = `srv-${input.sessionId}-${input.updateHash.slice(0, 24)}`;
        const blockIds = input.blockIds ?? [];
        await this.recordEvidenceBatch({
            projectId: input.projectId,
            sessionId: input.sessionId,
            clientSessionId: input.clientSessionId,
            source: "server_observed",
            rawPayload: input.payload ?? {},
            evidence: (blockIds.length > 0 ? blockIds : [undefined]).map((blockId) => ({
                projectId: input.projectId,
                userId: input.userId,
                evidenceId: blockId ? `${evidenceId}-${blockId}` : evidenceId,
                evidenceType: "server_observed_edit",
                source: "hocuspocus",
                strength: "strong",
                evidenceHash: input.updateHash,
                blockId,
                insertedChars: input.insertedChars ?? 0,
                deletedChars: input.deletedChars ?? 0,
                editCount: 1,
                payload: input.payload ?? {},
            })),
        });
        return evidenceId;
    }
    static async recordAnomaly(input) {
        const anomaly = await prisma_1.prisma.authorshipAnomaly.create({
            data: {
                project_id: input.projectId,
                user_id: input.userId ?? null,
                evidence_id: input.evidenceId ?? null,
                anomaly_type: input.anomalyType,
                severity: input.severity,
                score: input.score,
                message: input.message,
                metadata: input.metadata ?? {},
                detected_at: input.detectedAt ? new Date(input.detectedAt) : new Date(),
            },
        });
        logger_1.default.info("Authorship anomaly recorded", {
            anomalyId: anomaly.id,
            projectId: input.projectId,
            type: input.anomalyType,
            severity: input.severity,
        });
        return anomaly.id;
    }
    static async getProjectEvidenceSummary(projectId, userId) {
        const evidence = await prisma_1.prisma.authorshipEvidence.findMany({
            where: { project_id: projectId, user_id: userId },
            select: {
                id: true,
                evidence_type: true,
                source: true,
                strength: true,
                inserted_chars: true,
                deleted_chars: true,
                edit_count: true,
                ai_assisted: true,
                server_received_at: true,
                block_id: true,
            },
        });
        const collaborationSessions = await prisma_1.prisma.authorshipCollaborationSession.count({
            where: { project_id: projectId, user_id: userId },
        });
        const anomalies = await prisma_1.prisma.authorshipAnomaly.findMany({
            where: { project_id: projectId, user_id: userId },
            orderBy: { detected_at: "desc" },
            take: 50,
        });
        return {
            evidence,
            collaborationSessions,
            anomalies,
        };
    }
    static async getProjectContributions(projectId) {
        const contributions = await prisma_1.prisma.authorshipContribution.findMany({
            where: { project_id: projectId },
            include: {
                user: {
                    select: {
                        id: true,
                        email: true,
                        full_name: true,
                        avatar_url: true,
                    },
                },
            },
            orderBy: { contribution_score: "desc" },
        });
        const sessions = await prisma_1.prisma.authorshipCollaborationSession.findMany({
            where: { project_id: projectId },
            select: {
                user_id: true,
                authenticated_at: true,
                disconnected_at: true,
            },
        });
        const evidence = await prisma_1.prisma.authorshipEvidence.findMany({
            where: { project_id: projectId },
            select: { user_id: true },
        });
        const evidenceCounts = evidence.reduce((counts, item) => {
            if (!item.user_id)
                return counts;
            counts[item.user_id] = (counts[item.user_id] ?? 0) + 1;
            return counts;
        }, {});
        const sessionCounts = sessions.reduce((counts, item) => {
            counts[item.user_id] = (counts[item.user_id] ?? 0) + 1;
            return counts;
        }, {});
        const sessionMinutes = sessions.reduce((counts, item) => {
            const end = item.disconnected_at ?? new Date();
            const minutes = Math.max(0, Math.round((end.getTime() - item.authenticated_at.getTime()) / 60_000));
            counts[item.user_id] = (counts[item.user_id] ?? 0) + minutes;
            return counts;
        }, {});
        return contributions.map((contribution) => ({
            userId: contribution.user_id,
            userName: contribution.user.full_name || contribution.user.email.split("@")[0] || "Unknown user",
            userEmail: contribution.user.email,
            avatarUrl: contribution.user.avatar_url,
            insertedChars: contribution.inserted_chars,
            deletedChars: contribution.deleted_chars,
            editCount: contribution.edit_count,
            serverObservedEdits: contribution.server_observed_edits,
            aiAssistedEdits: contribution.ai_assisted_edits,
            offlineEdits: contribution.offline_edits,
            contributionScore: contribution.contribution_score,
            collaborationSessions: sessionCounts[contribution.user_id] ?? 0,
            evidenceCount: evidenceCounts[contribution.user_id] ?? 0,
            activeMinutes: sessionMinutes[contribution.user_id] ?? 0,
            firstContributionAt: contribution.first_contribution_at?.toISOString() ?? null,
            lastContributionAt: contribution.last_contribution_at?.toISOString() ?? null,
        }));
    }
    static async rebuildContributions(projectId) {
        const evidence = await prisma_1.prisma.authorshipEvidence.findMany({
            where: { project_id: projectId },
            orderBy: { server_received_at: "asc" },
        });
        const grouped = new Map();
        for (const item of evidence) {
            if (!item.user_id)
                continue;
            const blockId = item.block_id?.trim() || "__document";
            const key = `${item.user_id}:${blockId}`;
            const existing = grouped.get(key) ??
                {
                    userId: item.user_id,
                    blockId,
                    sectionTitle: item.section_title ?? undefined,
                    insertedChars: 0,
                    deletedChars: 0,
                    editCount: 0,
                    serverObservedEdits: 0,
                    aiAssistedEdits: 0,
                    offlineEdits: 0,
                    contributionScore: 0,
                    firstContributionAt: null,
                    lastContributionAt: null,
                };
            existing.insertedChars += item.inserted_chars;
            existing.deletedChars += item.deleted_chars;
            existing.editCount += item.edit_count;
            existing.aiAssistedEdits += item.ai_assisted ? item.edit_count : 0;
            existing.serverObservedEdits +=
                item.source === "hocuspocus" || item.evidence_type === "server_observed_edit"
                    ? item.edit_count
                    : 0;
            existing.offlineEdits +=
                item.payload && typeof item.payload === "object"
                    ? Number(item.payload.offline ?? 0)
                    : 0;
            existing.firstContributionAt = existing.firstContributionAt
                ? new Date(Math.min(existing.firstContributionAt.getTime(), item.server_received_at.getTime()))
                : item.server_received_at;
            existing.lastContributionAt = item.server_received_at;
            existing.contributionScore =
                existing.serverObservedEdits * 1 +
                    existing.aiAssistedEdits * 0.4 -
                    existing.offlineEdits * 0.25;
            grouped.set(key, existing);
        }
        await prisma_1.prisma.$transaction(grouped.size > 0
            ? Array.from(grouped.values()).map((summary) => prisma_1.prisma.authorshipContribution.upsert({
                where: {
                    project_id_user_id_block_id: {
                        project_id: projectId,
                        user_id: summary.userId,
                        block_id: summary.blockId ?? "__document",
                    },
                },
                update: {
                    inserted_chars: summary.insertedChars,
                    deleted_chars: summary.deletedChars,
                    edit_count: summary.editCount,
                    server_observed_edits: summary.serverObservedEdits,
                    ai_assisted_edits: summary.aiAssistedEdits,
                    offline_edits: summary.offlineEdits,
                    contribution_score: summary.contributionScore,
                    first_contribution_at: summary.firstContributionAt,
                    last_contribution_at: summary.lastContributionAt,
                },
                create: {
                    project_id: projectId,
                    user_id: summary.userId,
                    block_id: summary.blockId ?? "__document",
                    section_title: summary.sectionTitle,
                    inserted_chars: summary.insertedChars,
                    deleted_chars: summary.deletedChars,
                    edit_count: summary.editCount,
                    server_observed_edits: summary.serverObservedEdits,
                    ai_assisted_edits: summary.aiAssistedEdits,
                    offline_edits: summary.offlineEdits,
                    contribution_score: summary.contributionScore,
                    first_contribution_at: summary.firstContributionAt,
                    last_contribution_at: summary.lastContributionAt,
                },
            }))
            : []);
    }
    static normalizeEvidenceInput(batch, evidence) {
        const evidenceHash = evidence.evidenceHash ??
            this.hashPayload({
                projectId: evidence.projectId,
                userId: evidence.userId,
                evidenceId: evidence.evidenceId,
                evidenceType: evidence.evidenceType,
                source: evidence.source,
                eventTimestamp: evidence.eventTimestamp,
                blockId: evidence.blockId,
                insertedChars: evidence.insertedChars,
                deletedChars: evidence.deletedChars,
                payload: evidence.payload,
            });
        const projectId = evidence.projectId || batch.projectId;
        const blockId = evidence.blockId?.trim() || "__document";
        return {
            ...evidence,
            projectId,
            blockId,
            evidenceHash,
            serverReceivedAt: evidence.serverReceivedAt ?? new Date().toISOString(),
        };
    }
}
exports.AuthorshipEvidenceService = AuthorshipEvidenceService;
