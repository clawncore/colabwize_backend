/**
 * Citation normalizer: converts provider-specific citation data
 * (Zotero, Mendeley, manual input) into the unified CanonicalCitation shape.
 */

import type {
  CanonicalCitation,
  CSLAuthor,
  CitationProvider,
} from '../models/CanonicalCitation.js';

import { normalizeToCSL } from './cslNormalization.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a flat author string from a CSLAuthor array for legacy compat. */
function flattenAuthors(authors: CSLAuthor[]): string {
  if (!authors || authors.length === 0) return 'Unknown Author';
  return authors
    .map((a) => {
      if (a.literal) return a.literal;
      const parts = [a.family, a.given].filter(Boolean);
      return parts.length > 0 ? parts.join(', ') : 'Unknown Author';
    })
    .join('; ');
}

/** Extract a 4-digit year from a CSL date object. */
function extractYear(issued: { 'date-parts': number[][]; literal?: string } | undefined): number | null {
  if (!issued) return null;
  const parts = issued['date-parts'];
  if (Array.isArray(parts) && parts.length > 0 && parts[0].length > 0) {
    const y = parts[0][0];
    if (typeof y === 'number' && y > 0) return y;
  }
  if (issued.literal) {
    const m = issued.literal.match(/\d{4}/);
    if (m) return parseInt(m[0], 10);
  }
  return null;
}

/** Generate a stable id from provider + providerId. */
function buildId(provider: CitationProvider, providerId: string | null): string {
  if (providerId) return `${provider}:${providerId}`;
  return `${provider}:${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/** Build the base CanonicalCitation with defaults. */
function baseCitation(
  provider: CitationProvider,
  providerId: string | null,
  rawMetadata: Record<string, any> | null,
): CanonicalCitation {
  const now = new Date();
  return {
    id: buildId(provider, providerId),
    title: '',
    authors: [],
    year: null,
    type: 'article-journal',
    doi: null,
    url: null,
    isbn: null,
    issn: null,
    pmid: null,
    pmcid: null,
    arxiv: null,
    journal: null,
    containerTitle: null,
    volume: null,
    issue: null,
    pages: null,
    publisher: null,
    abstract: null,
    keywords: [],
    tags: [],
    provider,
    providerId,
    rawMetadata,
    attachments: [],
    isFavorite: false,
    readingStatus: 'unread',
    collections: [],
    authenticityScore: 0,
    vaultVerified: false,
    author: '',
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Zotero normalizer
// ---------------------------------------------------------------------------

export function normalizeZoteroItem(item: any, _userId: string): CanonicalCitation {
  // Zotero items may wrap data in item.data (CSL-JSON) or be raw
  const raw = item?.data ?? item;
  const providerId: string | null = item?.key ?? raw?.id ?? null;

  // Run through the CSL normalizer for standard fields
  const csl = normalizeToCSL(raw);

  const citation = baseCitation('zotero', providerId, item ?? raw);

  citation.title = csl.title || raw?.title || 'Untitled';
  citation.type = csl.type || raw?.type || 'article-journal';

  // Map CSL authors back to CSLAuthor[]
  citation.authors = (csl.author ?? []).map((a) => ({
    family: a.family,
    given: a.given,
    literal: a.literal,
  }));
  citation.author = flattenAuthors(citation.authors);

  citation.year = extractYear(csl.issued);

  // Identifiers
  citation.doi = raw?.DOI ?? csl.DOI ?? null;
  citation.url = raw?.url ?? raw?.URL ?? csl.URL ?? null;
  citation.isbn = raw?.ISBN ?? csl.ISBN ?? null;
  citation.issn = raw?.ISSN ?? raw?.issn ?? null;
  citation.pmid = raw?.pmid ?? null;
  citation.pmcid = raw?.pmcid ?? null;
  citation.arxiv = raw?.arxiv ?? null;

  // Publication info
  citation.journal = raw?.journal ?? raw?.containerTitle ?? raw?.['container-title'] ?? csl['container-title'] ?? null;
  citation.containerTitle = raw?.containerTitle ?? raw?.['container-title'] ?? csl['container-title'] ?? null;
  citation.volume = raw?.volume ?? csl.volume ?? null;
  citation.issue = raw?.issue ?? csl.issue ?? null;
  citation.pages = raw?.pages ?? raw?.page ?? csl.page ?? null;
  citation.publisher = raw?.publisher ?? csl.publisher ?? null;

  // Content
  citation.abstract = raw?.abstract ?? csl.abstract ?? null;
  citation.keywords = Array.isArray(raw?.tags)
    ? raw.tags.map((t: any) => (typeof t === 'string' ? t : t?.tag ?? '')).filter(Boolean)
    : [];
  citation.tags = [...citation.keywords];

  // Attachments (Zotero stores them in item.attachments or item.data.attachments)
  const rawAttachments = raw?.attachments ?? item?.attachments ?? [];
  citation.attachments = rawAttachments.map((att: any) => ({
    type: att?.type ?? att?.itemType ?? 'attachment',
    title: att?.title ?? null,
    url: att?.url ?? null,
    mimeType: att?.mimeType ?? att?.contentType ?? null,
    size: att?.size ?? null,
  }));

  return citation;
}

// ---------------------------------------------------------------------------
// Mendeley normalizer
// ---------------------------------------------------------------------------

export function normalizeMendeleyItem(item: any, _userId: string): CanonicalCitation {
  const raw = item ?? {};
  const providerId: string | null = raw?.id ?? null;

  // Build a CSL-friendly intermediate object from Mendeley's flat structure
  const cslInput: Record<string, any> = {
    id: raw?.id,
    title: raw?.title,
    type: raw?.type ?? 'journal',
    year: raw?.year,
    abstract: raw?.abstract,
    volume: raw?.volume,
    issue: raw?.issue,
    pages: raw?.pages,
    publisher: raw?.publisher,
    journal: raw?.journal ?? raw?.source,
  };

  // Map Mendeley authors: [{first_name, last_name}] -> [{given, family}]
  if (Array.isArray(raw?.authors)) {
    cslInput.author = raw.author.map((a: any) => ({
      given: a?.first_name ?? a?.given ?? undefined,
      family: a?.last_name ?? a?.family ?? undefined,
    }));
  }

  // Extract DOI from identifiers
  if (raw?.identifiers && typeof raw.identifiers === 'object') {
    if (raw.identifiers.doi) {
      cslInput.doi = raw.identifiers.doi;
      cslInput.DOI = raw.identifiers.doi;
    }
    if (raw.identifiers.isbn) cslInput.isbn = raw.identifiers.isbn;
    if (raw.identifiers.issn) cslInput.issn = raw.identifiers.issn;
    if (raw.identifiers.pmid) cslInput.pmid = raw.identifiers.pmid;
    if (raw.identifiers.pmcid) cslInput.pmcid = raw.identifiers.pmcid;
    if (raw.identifiers.arxiv) cslInput.arxiv = raw.identifiers.arxiv;
  }

  // Extract URL from websites array
  if (Array.isArray(raw?.websites) && raw.websites.length > 0) {
    cslInput.url = raw.websites[0];
    cslInput.URL = raw.websites[0];
  }

  // Run through CSL normalizer for date/volume/issue normalization
  const csl = normalizeToCSL(cslInput);

  const citation = baseCitation('mendeley', providerId, raw);

  citation.title = csl.title || raw?.title || 'Untitled';
  citation.type = csl.type || 'article-journal';

  // Authors: prefer our mapped CSL authors, fall back to CSL output
  const mappedAuthors: CSLAuthor[] = (cslInput.author ?? csl.author ?? []).map((a: any) => ({
    family: a?.family,
    given: a?.given,
    literal: a?.literal,
  }));
  citation.authors = mappedAuthors.length > 0 ? mappedAuthors : [{ literal: 'Unknown Author' }];
  citation.author = flattenAuthors(citation.authors);

  citation.year = extractYear(csl.issued) ?? (raw?.year ? parseInt(String(raw.year), 10) : null);

  // Identifiers
  citation.doi = raw?.identifiers?.doi ?? csl.DOI ?? null;
  citation.url = (Array.isArray(raw?.websites) && raw.websites[0]) ?? csl.URL ?? null;
  citation.isbn = raw?.identifiers?.isbn ?? csl.ISBN ?? null;
  citation.issn = raw?.identifiers?.issn ?? null;
  citation.pmid = raw?.identifiers?.pmid ?? null;
  citation.pmcid = raw?.identifiers?.pmcid ?? null;
  citation.arxiv = raw?.identifiers?.arxiv ?? null;

  // Publication info
  citation.journal = raw?.journal ?? raw?.source ?? csl['container-title'] ?? null;
  citation.containerTitle = raw?.journal ?? raw?.source ?? csl['container-title'] ?? null;
  citation.volume = raw?.volume ?? csl.volume ?? null;
  citation.issue = raw?.issue ?? csl.issue ?? null;
  citation.pages = raw?.pages ?? csl.page ?? null;
  citation.publisher = raw?.publisher ?? csl.publisher ?? null;

  // Content
  citation.abstract = raw?.abstract ?? csl.abstract ?? null;
  citation.keywords = Array.isArray(raw?.keywords)
    ? raw.keywords.filter((k: any) => typeof k === 'string')
    : [];
  citation.tags = Array.isArray(raw?.tags)
    ? raw.tags.filter((t: any) => typeof t === 'string')
    : [];

  // Attachments: Mendeley may include files array
  const rawFiles = raw?.files ?? raw?.attachments ?? [];
  citation.attachments = rawFiles.map((f: any) => ({
    type: f?.type ?? f?.fileType ?? 'file',
    title: f?.title ?? f?.name ?? null,
    url: f?.url ?? f?.download_url ?? null,
    mimeType: f?.mimeType ?? f?.content_type ?? null,
    size: f?.size ?? null,
  }));

  return citation;
}

// ---------------------------------------------------------------------------
// Manual input normalizer
// ---------------------------------------------------------------------------

export function normalizeManualInput(data: Record<string, any>): CanonicalCitation {
  const raw = data ?? {};
  const providerId: string | null = raw?.id ?? null;

  // Build CSL-friendly input from manual data
  const cslInput: Record<string, any> = {
    id: raw?.id,
    title: raw?.title,
    type: raw?.type,
    year: raw?.year,
    abstract: raw?.abstract,
    volume: raw?.volume,
    issue: raw?.issue,
    pages: raw?.pages,
    publisher: raw?.publisher,
    journal: raw?.journal ?? raw?.containerTitle,
    doi: raw?.doi,
    url: raw?.url,
    isbn: raw?.isbn,
    issn: raw?.issn,
    pmid: raw?.pmid,
    pmcid: raw?.pmcid,
    arxiv: raw?.arxiv,
  };

  // Handle authors: can be flat string, array of strings, or array of objects
  if (raw?.authors !== undefined) {
    cslInput.author = raw.authors;
  } else if (raw?.author !== undefined) {
    cslInput.author = raw.author;
  }

  // Run through CSL normalizer
  const csl = normalizeToCSL(cslInput);

  const citation = baseCitation('manual', providerId, raw);

  citation.title = csl.title || raw?.title || 'Untitled';
  citation.type = csl.type || raw?.type || 'article-journal';

  // Authors: accept flat or structured
  const cslAuthors: CSLAuthor[] = (csl.author ?? []).map((a: any) => ({
    family: a?.family,
    given: a?.given,
    literal: a?.literal,
  }));
  citation.authors = cslAuthors.length > 0 ? cslAuthors : [{ literal: 'Unknown Author' }];
  citation.author = flattenAuthors(citation.authors);

  citation.year = extractYear(csl.issued) ?? (raw?.year ? parseInt(String(raw.year), 10) : null);

  // Identifiers
  citation.doi = raw?.doi ?? csl.DOI ?? null;
  citation.url = raw?.url ?? csl.URL ?? null;
  citation.isbn = raw?.isbn ?? csl.ISBN ?? null;
  citation.issn = raw?.issn ?? null;
  citation.pmid = raw?.pmid ?? null;
  citation.pmcid = raw?.pmcid ?? null;
  citation.arxiv = raw?.arxiv ?? null;

  // Publication info
  citation.journal = raw?.journal ?? raw?.containerTitle ?? csl['container-title'] ?? null;
  citation.containerTitle = raw?.containerTitle ?? raw?.journal ?? csl['container-title'] ?? null;
  citation.volume = raw?.volume ?? csl.volume ?? null;
  citation.issue = raw?.issue ?? csl.issue ?? null;
  citation.pages = raw?.pages ?? csl.page ?? null;
  citation.publisher = raw?.publisher ?? csl.publisher ?? null;

  // Content
  citation.abstract = raw?.abstract ?? csl.abstract ?? null;
  citation.keywords = Array.isArray(raw?.keywords) ? raw.keywords.filter((k: any) => typeof k === 'string') : [];
  citation.tags = Array.isArray(raw?.tags) ? raw.tags.filter((t: any) => typeof t === 'string') : [];

  return citation;
}

// ---------------------------------------------------------------------------
// Unified dispatcher
// ---------------------------------------------------------------------------

export function normalizeCitation(
  source: any,
  provider: CitationProvider,
  userId?: string,
): CanonicalCitation {
  switch (provider) {
    case 'zotero':
      return normalizeZoteroItem(source, userId ?? '');
    case 'mendeley':
      return normalizeMendeleyItem(source, userId ?? '');
    case 'manual':
      return normalizeManualInput(source);
    case 'crossref':
      // CrossRef responses are already close to CSL-JSON; treat as manual input
      return normalizeManualInput(source);
    default:
      // Exhaustive fallback — should not happen with proper typing
      return normalizeManualInput(source);
  }
}
