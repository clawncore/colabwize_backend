// Backend Types for Citation Audit - FINAL RULE CONTRACT

export type CitationStyle = "APA" | "MLA" | "IEEE" | "Chicago";

export type PatternType =
  | "NUMERIC_BRACKET" // [1]
  | "AUTHOR_YEAR" // (Smith, 2023)
  | "AUTHOR_PAGE" // (Smith 24)
  | "et_al_no_period" // et al
  | "et_al_with_period" // et al.
  | "AMPERSAND_IN_PAREN" // (Smith & Jones)
  | "AND_IN_PAREN" // (Smith and Jones)
  | "MIXED_STYLE"; // Mixture of styles in one document

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
export type CitationViolationType =
  | "INLINE_STYLE"
  | "REF_LIST_ENTRY"
  | "STRUCTURAL"
  | "VERIFICATION"
  | "FORMATTING"
  | "DUPLICATES"
  | "BIBLIOGRAPHY"
  | "MAPPING";

export interface CitationFlag {
  type: CitationViolationType;
  ruleId: string; // e.g., "MLA.NO_NUMERIC"
  message: string;
  anchor?: {
    start: number;
    end: number;
    text: string;
  };
  category?: string;
  section?: string;
  expected?: string;
}

// Verification Results (separate from flags)
export type VerificationStatus =
  | "VERIFIED" // Paper found and matches
  | "VERIFICATION_FAILED" // Paper not found or low similarity
  | "UNMATCHED_REFERENCE" // Inline citation has no matching reference
  | "INSUFFICIENT_INFO"; // Citation too short to verify

export interface VerificationResult {
  inlineLocation: {
    start: number;
    end: number;
    text: string;
  };
  status: VerificationStatus;
  referenceId?: string;
  referenceIndex?: number;
  existenceStatus?: "CONFIRMED" | "NOT_FOUND" | "UNMATCHED" | "UNKNOWN";
  supportStatus?: "SUPPORTED" | "DISPUTED" | "PARTIALLY_SUPPORTED" | "UNRELATED" | "PENDING" | "UNSUPPORTED";
  message: string;
  similarity?: number;
  issues?: string[];
  foundPaper?: {
    title: string;
    year?: number;
    url: string;
    database: string;
    abstract?: string;
    isRetracted?: boolean;
    authors?: string[];
  };
  suggestedMatches?: any[];
  semanticSupport?: {
    status:
    | "SUPPORTED"
    | "DISPUTED"
    | "PARTIALLY_SUPPORTED"
    | "UNRELATED"
    | "PENDING";
    reasoning: string;
  };
}

export interface ScoreBreakdownItem {
  id: string;
  label: string;
  count: number;
  penalty: number;
  impact: 'CRITICAL' | 'MAJOR' | 'MINOR';
}

export interface AuditReport {
  style: CitationStyle;
  timestamp: string;
  flags: CitationFlag[];
  issues: any[];
  verificationResults?: VerificationResult[];
  detectedStyles?: string[];
  integrityIndex?: number;
  scoreBreakdown?: ScoreBreakdownItem[];
  summary: {
    totalInTextCitations: number;
    uniqueBibliographyEntries: number;
    brokenCitations: number;
    uncitedReferences: number;
    duplicatesDetected: number;
    invalidUrls: number;
    complianceScore: number;
    sourceHealth?: {
      peerReviewed: number;
      web: number;
      unknown: number;
    };
    auditTime?: string;
  };
  tierMetadata?: any;
}

// Legacy types for compatibility
export type AuditResponse = AuditReport;
export type AuditTier = "TIER_1_BASIC" | "TIER_2_FORENSIC" | "TIER_3_SEMANTIC";
