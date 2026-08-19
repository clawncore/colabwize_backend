export type AuthorshipEvidenceSource =
  | "hocuspocus"
  | "editor_api"
  | "ai_service"
  | "client_sdk"
  | "system";

export type AuthorshipEvidenceStrength = "strong" | "medium" | "weak";

export type AuthorshipEvidenceType =
  | "server_observed_edit"
  | "collaboration_update"
  | "ai_assistance"
  | "document_snapshot"
  | "client_telemetry"
  | "anomaly";

export type AuthorshipEvidenceBatchSource =
  | "server_observed"
  | "client_batch"
  | "ai_service"
  | "system";

export interface AuthorshipEvidencePayload {
  projectId: string;
  userId: string;
  evidenceId: string;
  evidenceType: AuthorshipEvidenceType;
  source: AuthorshipEvidenceSource;
  strength: AuthorshipEvidenceStrength;
  sessionId?: string;
  clientSessionId?: string;
  collaborationSessionId?: string;
  evidenceHash?: string;
  serverReceivedAt?: string;
  eventTimestamp?: string;
  blockId?: string;
  sectionTitle?: string;
  contentHash?: string;
  insertedChars?: number;
  deletedChars?: number;
  editCount?: number;
  aiAssisted?: boolean;
  anomalyScore?: number;
  payload?: Record<string, unknown>;
}

export interface AuthorshipEvidenceBatchPayload {
  projectId: string;
  sessionId?: string;
  clientSessionId?: string;
  source: AuthorshipEvidenceBatchSource;
  rawPayload?: Record<string, unknown>;
  evidence: AuthorshipEvidencePayload[];
}

export interface AuthorshipContributionSummary {
  userId: string;
  blockId?: string;
  sectionTitle?: string;
  insertedChars: number;
  deletedChars: number;
  editCount: number;
  serverObservedEdits: number;
  aiAssistedEdits: number;
  offlineEdits: number;
  contributionScore: number;
  firstContributionAt: Date | null;
  lastContributionAt: Date | null;
}

export interface AuthorshipContributionDetail {
  userId: string;
  userName: string;
  userEmail: string;
  avatarUrl?: string | null;
  insertedChars: number;
  deletedChars: number;
  editCount: number;
  serverObservedEdits: number;
  aiAssistedEdits: number;
  offlineEdits: number;
  contributionScore: number;
  collaborationSessions: number;
  evidenceCount: number;
  activeMinutes: number;
  firstContributionAt: string | null;
  lastContributionAt: string | null;
}

export interface AuthorshipAnomalyPayload {
  projectId: string;
  userId?: string;
  evidenceId?: string;
  anomalyType: string;
  severity: "low" | "medium" | "high" | "critical";
  score: number;
  message: string;
  metadata?: Record<string, unknown>;
  detectedAt?: string;
}

export interface ConfidenceDimension {
  score: number;
  label: "High" | "Medium" | "Low" | "Insufficient";
  confidenceInterval: [number, number];
  evidenceCount: number;
  rationale: string[];
}

export interface RiskDimension {
  score: number;
  label: "Low" | "Medium" | "High" | "Critical";
  confidenceInterval: [number, number];
  flags: Array<{
    type: string;
    severity: "low" | "medium" | "high" | "critical";
    message: string;
  }>;
}

export interface AuthorshipConfidenceReportPayload {
  projectId: string;
  userId: string;
  generatedAt: string;
  attributionConfidence: ConfidenceDimension;
  contributionConfidence: ConfidenceDimension;
  collaborationClarity: ConfidenceDimension;
  evidenceCompleteness: ConfidenceDimension;
  aiAssistanceTransparency: ConfidenceDimension;
  anomalyRisk: RiskDimension;
  overallReliability: {
    label: "High" | "Medium" | "Low" | "Insufficient";
    score: number;
    confidenceInterval: [number, number];
    rationale: string[];
  };
  limitations: string[];
  evidenceSummary: {
    totalEvidence: number;
    strongEvidence: number;
    mediumEvidence: number;
    weakEvidence: number;
    serverObservedEvidence: number;
    aiAssistedEvidence: number;
    collaborationSessions: number;
    anomalies: number;
  };
}
