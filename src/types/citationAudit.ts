// Backend Types for Citation Audit - FINAL RULE CONTRACT

export type CitationStyle = "APA" | "MLA" | "IEEE" | "Chicago";

export type PatternType =
    | "NUMERIC_BRACKET"   // [1]
    | "AUTHOR_YEAR"       // (Smith, 2023)
    | "AUTHOR_PAGE"       // (Smith 24)
    | "et_al_no_period"   // et al
    | "et_al_with_period" // et al.
    | "AMPERSAND_IN_PAREN" // (Smith & Jones)
    | "AND_IN_PAREN";      // (Smith and Jones)

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

// Verification Results (separate from flags)
export type VerificationStatus =
    | "VERIFIED"                // Paper found and matches
    | "VERIFICATION_FAILED"      // Paper not found or low similarity
    | "UNMATCHED_REFERENCE"      // Inline citation has no matching reference
    | "INSUFFICIENT_INFO";       // Citation too short to verify

export interface VerificationResult {
    inlineLocation: {
        start: number;
        end: number;
        text: string;
    };
    status: VerificationStatus;
    message: string;
    similarity?: number;
    foundPaper?: {
        title: string;
        year?: number;
        url: string;
        database: string;
    };
}

export interface AuditReport {
    style: CitationStyle;
    timestamp: string;
    flags: CitationFlag[];
    verificationResults?: VerificationResult[];  // NEW: Separate verification results
    detectedStyles?: string[]; // Auto-detected style indicators
}
