export interface CSLAuthor {
  family?: string;
  given?: string;
  literal?: string;
}

export interface CSLDate {
  'date-parts': number[][];
  literal?: string;
}

export interface CanonicalCitation {
  // Core metadata
  id: string;
  title: string;
  authors: CSLAuthor[];
  year: number | null;
  type: string;

  // Identifiers
  doi: string | null;
  url: string | null;
  isbn: string | null;
  issn: string | null;
  pmid: string | null;
  pmcid: string | null;
  arxiv: string | null;

  // Publication info
  journal: string | null;
  containerTitle: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  publisher: string | null;

  // Content
  abstract: string | null;
  keywords: string[];
  tags: string[];

  // Provider tracking
  provider: 'zotero' | 'mendeley' | 'manual' | 'crossref';
  providerId: string | null;

  // Round-trip fidelity
  rawMetadata: Record<string, any> | null;

  // Attachments (PDFs, notes)
  attachments: Array<{
    type: string;
    title: string | null;
    url: string | null;
    mimeType: string | null;
    size: number | null;
  }>;

  // User organization
  isFavorite: boolean;
  readingStatus: 'unread' | 'reading' | 'read';
  collections: string[]; // collection IDs

  // Integrity
  authenticityScore: number; // 0-100
  vaultVerified: boolean;

  // Legacy compat
  author: string; // flat string for backwards compat

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export type CitationProvider = 'zotero' | 'mendeley' | 'manual' | 'crossref';
