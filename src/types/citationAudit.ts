// Backend Types for Citation Audit - FINAL RULE CONTRACT

export type CitationStyle = "APA" | "MLA" | "IEEE" | "Chicago";

export type PatternType =
    | "NUMERIC_BRACKET"   // [1]
    | "AUTHOR_YEAR"       // (Smith, 2023)
    | "AUTHOR_PAGE"       // (Smith 24)
    | "et_al_no_period"   // et al
    | "et_al_with_period" // et al.
    | "AMPERSAND_IN_PAREN" // (Smith & Jones)
    | "AND_IN_PAREN"      // (Smith and Jones)
    | "MIXED_STYLE"; // Global flag for mixed styles

export interface DocumentMeta {
    language: string;
    editor: string;
}

export type SectionType = "BODY" | "REFERENCE_SECTION";

export interface DocumentSection {
    title: string;
    type: SectionType;
    // We might want to track range here if needed for structural flags
    range?: { start: number; end: number };
}

export interface ExtractedPattern {
    patternType: PatternType;
    text: string;
    start: number;
    end: number;
    section: SectionType;
    context?: string;
}

export interface ReferenceEntry {
    index: number;
    rawText: string;
    start: number; // Anchor for the entry
    end: number;
}

export interface ReferenceListExtraction {
    sectionTitle: string;
    entries: ReferenceEntry[];
}

// Backend Request Payload
export interface AuditRequest {
    declaredStyle: CitationStyle;
    documentMeta: DocumentMeta;
    sections: DocumentSection[];
    patterns: ExtractedPattern[];
    referenceList: ReferenceListExtraction | null; // Null if no ref list found
}

// Backend Response Types
export type CitationViolationType = "INLINE_STYLE" | "REF_LIST_ENTRY" | "STRUCTURAL" | "VERIFICATION";

export interface CitationFlag {
    type: CitationViolationType;
    ruleId: string; // e.g., "MLA.NO_NUMERIC"
    message: string;
    anchor?: {
        start: number;
        end: number;
        text: string;
    };
    category?: CitationViolationType; // Deprecated by 'type', but keeping for compatibility if needed. Actually 'type' covers it.
    // Let's use 'type' as the main classifier as per prompt.
    // Structural details
    section?: string;
    expected?: string;
}

// Verification Results (separate from flags) - SPLIT AXIS MODEL
export type ExistenceStatus =
    | "CONFIRMED"           // Paper Found (Match metadata/DOI)
    | "NOT_FOUND"           // Not in database or < 50% match
    | "SERVICE_ERROR"       // API Failure
    | "PENDING";            // Not run yet

export type SupportStatus =
    | "SUPPORTED"           // Semantic check confirms claim
    | "PLAUSIBLE"           // Abstract related, probabilistic support
    | "UNRELATED"           // Paper is real, but claim is orthogonal
    | "CONTRADICTORY"       // Paper explicitly disputes claim
    | "NOT_EVALUATED";      // No abstract or semantic check skipped

export interface VerificationProvenance {
    source: "CrossRef" | "PubMed" | "arXiv" | "Manual" | "Other";
    status: "SUCCESS" | "FAILED" | "SKIPPED";
    latencyMs?: number;
}

export interface VerificationResult {
    inlineLocation: {
        start: number;
        end: number;
        text: string;
    };

    // Axis 1: Existence (Is the paper real?)
    existenceStatus: ExistenceStatus;

    // Axis 2: Support (Does it back the claim?)
    supportStatus: SupportStatus;

    // Source Tracking (Where did we check?)
    provenance: VerificationProvenance[];

    message: string; // Aggregate user-friendly summary
    similarity?: number; // Match score (0-1) for reference string

    foundPaper?: {
        title: string;
        authors?: string[];
        year?: number;
        url: string;
        doi?: string;
        database: string;
        abstract?: string;
        isRetracted?: boolean;
    };

    // Detailed semantic reasoning (if SupportStatus != NOT_EVALUATED)
    semanticAnalysis?: {
        reasoning: string;
        confidence: number; // 0-1
    };
}

// Scoring Model
export interface CitationIntegrityIndex {
    totalScore: number;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    components: {
        styleScore: number;       // Based on style flags
        referenceScore: number;   // Based on bibliography completeness
        verificationScore: number; // Based on existence confirmation
        semanticScore: number;    // Based on claim alignment
    };
    verificationLimits: string[]; // Reasons for uncertainty (e.g. "Preprint source")
}

export interface AuditReport {
    style: CitationStyle;
    timestamp: string;
    flags: CitationFlag[];
    verificationResults?: VerificationResult[];
    detectedStyles?: string[];
    integrityIndex?: CitationIntegrityIndex; // NEW: Detailed scoring
}
