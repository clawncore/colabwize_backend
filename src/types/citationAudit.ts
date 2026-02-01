export type CitationStyle = "APA" | "MLA" | "IEEE" | "Chicago";

export type PatternType =
    | "NUMERIC_BRACKET"   // [1]
    | "AUTHOR_YEAR"       // (Smith, 2023)
    | "AUTHOR_PAGE"       // (Smith 24)
    | "et_al_no_period"   // et al
    | "et_al_with_period" // et al.
    | "AMPERSAND_IN_PAREN" // (Smith & Jones)
    | "AMPERSAND_IN_PAREN" // (Smith & Jones)
    | "AND_IN_PAREN"      // (Smith and Jones)
    | "MIXED_STYLE";       // Multiple styles detected

export interface DocumentMeta {
    language: string;
    editor: string;
}

export type SectionType = "BODY" | "REFERENCE_SECTION";

export interface DocumentSection {
    title: string;
    type: SectionType;
    range?: { start: number; end: number };
}

export interface ExtractedPattern {
    patternType: PatternType;
    text: string;
    start: number;
    end: number;
    section: SectionType;
    context?: string; // Surrounding sentence
    citationId?: string; // For normalization mapping
    normalizationStatus?: "resolved" | "ambiguous" | "unresolved";
    confidence?: number;
}

export interface ReferenceEntry {
    index: number;
    rawText: string;
    start: number;
    end: number;
}

export interface ReferenceListExtraction {
    sectionTitle: string;
    entries: ReferenceEntry[];
}

export interface AuditRequest {
    declaredStyle: CitationStyle;
    documentMeta: DocumentMeta;
    sections: DocumentSection[];
    patterns: ExtractedPattern[];
    referenceList: ReferenceListExtraction | null;
    citationLibrary?: Record<string, any>; // [NEW] Map of citationId -> metadata for Tier 1 matching
}

export type CitationViolationType = "INLINE_STYLE" | "REF_LIST_ENTRY" | "STRUCTURAL" | "VERIFICATION" | "RISK";

export interface CitationFlag {
    type: CitationViolationType;
    ruleId: string;
    message: string;
    anchor?: {
        start: number;
        end: number;
        text: string;
    };
    section?: string;
    expected?: string;
    tier?: AuditTier; // Which tier generated this flag
    reason?: string;  // Forensic requirement: Why this issue exists
    action?: string;  // Forensic requirement: What the user can do
    source?: string;  // Forensic requirement: Normalized citation reference
}

export type ExistenceStatus = "CONFIRMED" | "NOT_FOUND" | "SERVICE_ERROR" | "PENDING" | "UNMATCHED_REFERENCE";
export type SupportStatus = "SUPPORTED" | "WEAKLY_SUPPORTED" | "UNSUPPORTED" | "AMBIGUOUS" | "NOT_EVALUATED" | "PLAUSIBLE" | "CONTRADICTORY" | "UNRELATED";

export interface VerificationResult {
    inlineLocation?: { start: number; end: number; text: string };
    existenceStatus: ExistenceStatus;
    supportStatus: SupportStatus;
    provenance: any[];
    message: string;
    reason?: string;
    action?: string;
    source?: string;
    suggestions?: any[]; // "Find Papers" remediation suggestions
    similarity?: number;
    foundPaper?: {
        title?: string;
        authors?: string[];
        year?: number | string;
        url?: string;
        doi?: string;
        database?: string;
        abstract?: string;
        isRetracted?: boolean;
    };
    semanticAnalysis?: {
        reasoning?: string;
        confidence?: number;
    };
}

export interface VerificationProvenance {
    source: string;
    status: "SUCCESS" | "FAILED";
    latencyMs: number;
}

/**
 * TIERED AUDIT DEFINITIONS
 */
export enum AuditTier {
    STRUCTURAL = "STRUCTURAL", // Tier 1: Format only
    CLAIM = "CLAIM",           // Tier 2: Claim verification
    RISK = "RISK"              // Tier 3: Risk & Bias
}

export interface AuditResponse {
    style: CitationStyle;
    flags: CitationFlag[];
    verificationResults?: VerificationResult[];
    integrityIndex?: number;
    tiersExecuted: AuditTier[];
    tierMetadata?: {
        [key in AuditTier]?: {
            executed: boolean;
            skippedReason?: string;
            stats?: any;
        }
    };
}
