export type AuditSeverity = "CRITICAL" | "MAJOR" | "MINOR" | "INFO";
export type AuditStatus = "RUNNING" | "COMPLETED" | "FAILED";

export interface AuditMetadata {
    auditId: string;
    timestamp: string;
    documentId: string;
    projectId: string; // added projectId to help with db lookups if needed
    style: string;
    version: string;
}

export interface AuditSummaryMetrics {
    totalInTextCitations: number;
    uniqueBibliographyEntries: number;
    duplicatesDetected: number;
    brokenCitations: number;        // Citations without matching bibliography
    uncitedReferences: number;      // Bibliography entries without matching citations
    invalidUrls: number;
    formattingErrors: number;
    complianceScore: number;
    sourceHealth?: {
        peerReviewed: number;
        web: number;
        unknown: number;
    };
    auditTime?: string;
}

export interface AuditLocation {
    paragraph?: number;
    offset?: number;
    startPos?: number;
    endPos?: number;
}

export interface AuditIssue {
    id: string;
    category?: string;              // e.g., "VERIFICATION", "FORMATTING", "DUPLICATES"
    type: string;                 // e.g., "BROKEN_REFERENCE", "INVALID_URL", "FORMATTING"
    severity: AuditSeverity;
    location?: AuditLocation;
    referenceId?: string;         // e.g., "C12", or RefKey
    message: string;
    suggestedFix?: string;
    suggestedItems?: any[];
    autoFixAvailable: boolean;
}

export interface LinkValidationReport {
    url: string;
    formatValid: boolean;
    protocol: "HTTP" | "HTTPS" | "UNKNOWN";
    reachable: boolean;
    doiNormalized: boolean;
}

export interface DuplicateCluster {
    duplicateGroupId: string;
    references: string[];         // Array of reference IDs
    matchReason: string;          // e.g., "Same DOI" or "Fuzzy Title Match"
    confidence: number;
    recommendedPrimary: string;
}

export interface AuditReport {
    metadata: AuditMetadata;
    summary: AuditSummaryMetrics;
    issues: AuditIssue[];
    linkValidation: LinkValidationReport[];
    duplicates: DuplicateCluster[];
    // Extended fields for DB verification modal
    integrityIndex?: number;
    scoreBreakdown?: any[];
    flags?: any[];
    verificationResults?: any[];
    tierMetadata?: any;
}

export interface AuditJob {
    auditId: string;
    documentId: string;
    projectId: string;
    status: AuditStatus;
    progress: number;            // 0 to 100
    currentStage: string;
    startedAt: string;
    completedAt: string | null;
    report: AuditReport | null;
    error?: string;
}

export interface AuditPipelineStage {
    name: string;
    weight: number;              // Percentage of total progress (e.g., 10 for 10%)
    execute: (job: AuditJob, context: AuditContext) => Promise<void>;
}

// Internal context passed between pipeline stages
export interface AuditContext {
    userId: string;           // Required for user-specific lookups (Zotero)
    docState: any;             // ProseMirror JSON Document
    citations: any[];          // Extracted in-text citations
    bibliography: any[];       // Extracted bibliography entries
    citationIdMap: Map<string, any>; // Map for quick cross-referencing
}
