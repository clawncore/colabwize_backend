/**
 * Citation Hyperlink & Metadata Preservation Engine.
 *
 * Produces *semantically rich, fully linked* HTML for citations and the
 * bibliography BEFORE Pandoc ever sees the document. The design principle:
 *
 *   ColabWize understands citations. Pandoc only converts documents.
 *
 * So every in-text citation becomes an internal anchor (`href="#ref-<id>"`),
 * every bibliography entry gets a stable `id="ref-<id>"` plus clickable DOI/URL
 * links and a "↩ Back" link, and document metadata is exposed for Pandoc to
 * carry into DOCX/PDF core properties. Pandoc then preserves these links as
 * Word bookmarks / PDF internal links and real hyperlinks — it is never asked
 * to *understand* citations (no `--citeproc`).
 *
 * Pure and framework-free: no Pandoc dependency, fully unit-testable.
 */
import type {
  BlockNode,
  CanonicalDocument,
  CitationRun,
  Reference,
  ValidationFinding,
} from "../cdm";

/* ------------------------------- escaping -------------------------------- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ------------------------------- DOI / URL ------------------------------- */

/**
 * Normalize a DOI (or DOI-shaped string) into a canonical `https://doi.org/…`
 * URL. Returns `undefined` when the input is not a DOI. `doi:10.x/y` and
 * `10.x/y` both become `https://doi.org/10.x/y`.
 */
export function normalizeDoi(doi?: string): string | undefined {
  if (!doi) return undefined;
  const t = doi.trim();
  if (/^https?:\/\//i.test(t)) {
    return t.replace(/[.,;:!?)\]}'"]+$/, "");
  }
  const m = t.match(/^(?:doi:)?(10\.\d{4,9}\/\S+)$/i);
  if (!m) return undefined;
  const suffix = m[1].replace(/[.,;:!?)\]}'"]+$/, "");
  return `https://doi.org/${suffix}`;
}

/** True when the DOI is syntactically valid (after stripping prefixes). */
export function isValidDoi(doi?: string): boolean {
  if (!doi) return false;
  const core = doi
    .replace(/^doi:/i, "")
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/[.,;:!?)\]}'"]+$/, "");
  return /^10\.\d{4,9}\/\S+$/i.test(core);
}

function normalizeUrl(url?: string): string | undefined {
  if (!url) return undefined;
  const t = url.trim();
  if (/^https?:\/\//i.test(t)) return t.replace(/[.,;:!?)\]}'"]+$/, "");
  return undefined;
}

/* --------------------------- linkify reference text ---------------------- */

// Matches a bare http(s) URL OR a `doi:10.x/y` token. A single combined regex
// (one pass over the escaped text) means the anchors we insert are never
// re-scanned, so links never nest.
const LINK_RE = /(https?:\/\/[^\s<]+)|(\bdoi:(10\.\d{4,9}\/\S+))/gi;

/**
 * Escape plain reference text, then wrap any bare URL or `doi:…` token in an
 * `<a>` hyperlink. Safe because reference `raw` text contains no pre-existing
 * markup.
 */
export function linkifyText(raw: string): string {
  const escaped = escapeHtml(raw);
  return escaped.replace(
    LINK_RE,
    (_match, url?: string, _doiToken?: string, doiSuffix?: string) => {
      if (url) {
        const clean = url.replace(/[.,;:!?)\]}'"]+$/, "");
        return `<a class="ext-link" href="${clean}" rel="noopener">${clean}</a>`;
      }
      if (doiSuffix) {
        const clean = doiSuffix.replace(/[.,;:!?)\]}'"]+$/, "");
        const href = `https://doi.org/${clean}`;
        return `<a class="doi-link" href="${href}" rel="noopener">${href}</a>`;
      }
      return _match;
    },
  );
}

/* --------------------------- CSL-JSON fallback ---------------------------- */

function extractCslYear(csl: Record<string, unknown>): string {
  const issued = csl.issued as Record<string, unknown> | undefined;
  const parts = issued?.["date-parts"] as number[][] | undefined;
  if (parts?.[0]?.[0]) return String(parts[0][0]);
  const y = csl.year ?? (issued as Record<string, unknown> | undefined)?.year;
  return typeof y === "number" || typeof y === "string" ? String(y) : "";
}

/**
 * Lightweight CSL-JSON → plain-text reference, used only when `ref.raw` is
 * missing so we never fall back to a bare `id`.
 */
export function formatReferenceFromCsl(
  cslJson?: Record<string, unknown>,
): string {
  if (!cslJson) return "";
  const get = (k: string): string => {
    const v = cslJson[k];
    return typeof v === "string" ? v : "";
  };
  const authors = Array.isArray(cslJson.author)
    ? (cslJson.author as Array<Record<string, unknown>>)
        .map((a) => {
          const fam = typeof a.family === "string" ? a.family : "";
          const giv = typeof a.given === "string" ? a.given : "";
          return [fam, giv].filter(Boolean).join(", ");
        })
        .filter(Boolean)
    : [];
  const authorStr = authors.join("; ");
  const year = extractCslYear(cslJson);
  const title = get("title");
  const container = get("container-title") || get("container_title");
  const vol = get("volume");
  const issue = get("issue");
  const pages = get("page");
  const parts: string[] = [];
  if (authorStr) parts.push(authorStr);
  if (year) parts.push(`(${year})`);
  if (title) parts.push(`${title}.`);
  if (container) {
    let c = container;
    if (vol) c += ` ${vol}`;
    if (issue) c += `(${issue})`;
    if (pages) c += `, ${pages}`;
    c += ".";
    parts.push(c);
  }
  return parts.join(" ").trim();
}

/**
 * Produce the clickable HTML body for a single reference: the (enriched)
 * reference text with DOI/URL links, guaranteeing at least one clickable DOI
 * link when the reference carries a `doi`/`url` that wasn't already in `raw`.
 */
export function enrichReference(ref: Reference): string {
  const base = ref.raw?.trim()
    ? ref.raw
    : formatReferenceFromCsl(ref.cslJson);
  let html = linkifyText(base);
  const doiUrl = normalizeDoi(ref.doi) ?? normalizeUrl(ref.url);
  if (doiUrl && !html.includes(doiUrl)) {
    html += ` <a class="doi-link" href="${doiUrl}" rel="noopener">${escapeHtml(
      doiUrl,
    )}</a>`;
  }
  return html;
}

/* ----------------------------- in-text citation --------------------------- */

export interface InTextCitationCtx {
  /** Tracks first occurrence of each citationId so only one gets `id="cite-"`. */
  seen: Set<string>;
  /** citationId → 1-based display number, for aria-labels. */
  refOrder?: Map<string, number>;
}

/**
 * Render an in-text citation as a semantic, clickable anchor:
 *   <a href="#ref-<id>" id="cite-<id>" class="citation"
 *      data-citation-id="<id>" aria-label="Go to reference <n>">[15]</a>
 * `id="cite-<id>"` is assigned only on the first occurrence so the reference's
 * "↩ Back" link has a single stable target.
 */
export function renderInTextCitation(
  cite: CitationRun,
  ctx: InTextCitationCtx,
): string {
  const id = cite.citationId;
  const target = `ref-${escapeHtml(id)}`;
  const anchorId = ctx.seen.has(id)
    ? ""
    : ((ctx.seen.add(id), ` id="cite-${escapeHtml(id)}"`));
  const text = escapeHtml(cite.text ?? id);
  const n = ctx.refOrder?.get(id);
  const aria = n ? `Go to reference ${n}` : "Go to reference";
  return `<a href="#${target}"${anchorId} class="citation" data-citation-id="${escapeHtml(
    id,
  )}" aria-label="${aria}">${text}</a>`;
}

/* ------------------------------ bibliography ------------------------------ */

export interface BibliographyCtx {
  /** Ids that appeared as in-text citations (so we only add a back-link when cited). */
  seen: Set<string>;
}

/**
 * Render the full bibliography as a semantic, linked list. Each entry:
 *   <li id="ref-<id>" class="reference" data-citation-id="<id>" data-doi="…?">
 *     …enriched text with clickable DOI/URL…
 *     <a href="#cite-<id>" class="back-ref" aria-label="Back to citation">↩ Back</a>
 *   </li>
 * Anchor ids use the stable `citationId` (not the display number), so reordering
 * never breaks the in-text → reference links.
 */
export function renderBibliographyEnriched(
  doc: CanonicalDocument,
  ctx: BibliographyCtx,
): string {
  if (doc.references.length === 0) return "";
  const items = doc.references
    .map((r) => {
      const anchorId = `ref-${escapeHtml(r.id)}`;
      const doiAttr = normalizeDoi(r.doi)
        ? ` data-doi="${escapeHtml(normalizeDoi(r.doi) as string)}"`
        : "";
      const body = enrichReference(r);
      const back = ctx.seen.has(r.id)
        ? ` <a href="#cite-${escapeHtml(
            r.id,
          )}" class="back-ref" aria-label="Back to citation">↩ Back</a>`
        : "";
      return `<li id="${anchorId}" class="reference" data-citation-id="${escapeHtml(
        r.id,
      )}"${doiAttr}>${body}${back}</li>`;
    })
    .join("\n");
  return `<section class="references"><h2>References</h2><ol class="reference-list">${items}</ol></section>`;
}

/* ----------------------------- document metadata -------------------------- */

/**
 * Map `DocMetadata` → Pandoc `-M key=value` flags. Lists (author, keywords) are
 * joined so a single `-M` carries the whole value. Pandoc carries these into
 * DOCX/PDF core properties (title, author, keywords, abstract, date, language).
 */
export function buildCitationMetadata(
  doc: CanonicalDocument,
): Record<string, string> {
  const m: Record<string, string> = {};
  if (doc.metadata.title) m.title = doc.metadata.title;
  const authors = doc.metadata.authors
    .map((a) => (a.affiliation ? `${a.name} (${a.affiliation})` : a.name))
    .filter(Boolean);
  if (authors.length) m.author = authors.join("; ");
  if (doc.metadata.keywords.length) m.keywords = doc.metadata.keywords.join(", ");
  if (doc.metadata.abstract) m.abstract = doc.metadata.abstract;
  if (doc.metadata.date) m.date = doc.metadata.date;
  const lang = doc.settings.locale.split("-")[0];
  if (lang) m.lang = lang;
  return m;
}

/* ------------------------------- validation ------------------------------- */

export interface CitationLinkValidation {
  ok: boolean;
  findings: ValidationFinding[];
}

function collectCitationIds(
  blocks: BlockNode[],
): { id: string; blockIndex: number }[] {
  const out: { id: string; blockIndex: number }[] = [];
  const walk = (node: unknown, blockIndex: number): void => {
    if (Array.isArray(node)) {
      node.forEach((c) => walk(c, blockIndex));
      return;
    }
    if (node && typeof node === "object") {
      const o = node as Record<string, unknown>;
      if (o.type === "citation" && typeof o.citationId === "string") {
        out.push({ id: o.citationId, blockIndex });
      }
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (Array.isArray(v)) v.forEach((c) => walk(c, blockIndex));
        else if (v && typeof v === "object") walk(v, blockIndex);
      }
    }
  };
  blocks.forEach((b, i) => walk(b, i));
  return out;
}

/**
 * Cheap pre-pass that guarantees we never emit a dead `#ref-` link: every
 * in-text `citationId` must resolve to a `Reference`, reference anchor ids must
 * be unique, and any DOI must be syntactically valid. This is the *serialization*
 * half of Stage 14; the full blocking gate (style/mixed-style checks) lives in
 * the consolidated export pre-check plan and reuses these findings.
 */
export function validateCitationLinks(
  doc: CanonicalDocument,
): CitationLinkValidation {
  const findings: ValidationFinding[] = [];
  const refIds = new Set(doc.references.map((r) => r.id));

  const seenIds = new Set<string>();
  for (const r of doc.references) {
    if (seenIds.has(r.id)) {
      findings.push({
        severity: "error",
        code: "duplicate-reference-id",
        message: `Duplicate reference id "${r.id}" — anchor links will be ambiguous.`,
        locator: { citationId: r.id },
      });
    }
    seenIds.add(r.id);
    if (r.doi && !isValidDoi(r.doi)) {
      findings.push({
        severity: "warning",
        code: "invalid-doi",
        message: `Reference "${r.id}" has a malformed DOI "${r.doi}".`,
        locator: { citationId: r.id },
      });
    }
  }

  for (const c of collectCitationIds(doc.body)) {
    if (!refIds.has(c.id)) {
      findings.push({
        severity: "error",
        code: "unresolved-citation",
        message: `Citation "${c.id}" has no matching reference.`,
        locator: { citationId: c.id, blockIndex: c.blockIndex },
      });
    }
  }

  return { ok: !findings.some((f) => f.severity === "error"), findings };
}
