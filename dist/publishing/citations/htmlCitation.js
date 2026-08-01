"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDoi = normalizeDoi;
exports.isValidDoi = isValidDoi;
exports.linkifyText = linkifyText;
exports.formatReferenceFromCsl = formatReferenceFromCsl;
exports.enrichReference = enrichReference;
exports.renderInTextCitation = renderInTextCitation;
exports.renderBibliographyEnriched = renderBibliographyEnriched;
exports.buildCitationMetadata = buildCitationMetadata;
exports.validateCitationLinks = validateCitationLinks;
/* ------------------------------- escaping -------------------------------- */
function escapeHtml(value) {
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
function normalizeDoi(doi) {
    if (!doi)
        return undefined;
    const t = doi.trim();
    if (/^https?:\/\//i.test(t)) {
        return t.replace(/[.,;:!?)\]}'"]+$/, "");
    }
    const m = t.match(/^(?:doi:)?(10\.\d{4,9}\/\S+)$/i);
    if (!m)
        return undefined;
    const suffix = m[1].replace(/[.,;:!?)\]}'"]+$/, "");
    return `https://doi.org/${suffix}`;
}
/** True when the DOI is syntactically valid (after stripping prefixes). */
function isValidDoi(doi) {
    if (!doi)
        return false;
    const core = doi
        .replace(/^doi:/i, "")
        .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
        .replace(/[.,;:!?)\]}'"]+$/, "");
    return /^10\.\d{4,9}\/\S+$/i.test(core);
}
function normalizeUrl(url) {
    if (!url)
        return undefined;
    const t = url.trim();
    if (/^https?:\/\//i.test(t))
        return t.replace(/[.,;:!?)\]}'"]+$/, "");
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
function linkifyText(raw) {
    const escaped = escapeHtml(raw);
    return escaped.replace(LINK_RE, (_match, url, _doiToken, doiSuffix) => {
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
    });
}
/* --------------------------- CSL-JSON fallback ---------------------------- */
function extractCslYear(csl) {
    const issued = csl.issued;
    const parts = issued?.["date-parts"];
    if (parts?.[0]?.[0])
        return String(parts[0][0]);
    const y = csl.year ?? issued?.year;
    return typeof y === "number" || typeof y === "string" ? String(y) : "";
}
/**
 * Lightweight CSL-JSON → plain-text reference, used only when `ref.raw` is
 * missing so we never fall back to a bare `id`.
 */
function formatReferenceFromCsl(cslJson) {
    if (!cslJson)
        return "";
    const get = (k) => {
        const v = cslJson[k];
        return typeof v === "string" ? v : "";
    };
    const authors = Array.isArray(cslJson.author)
        ? cslJson.author
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
    const parts = [];
    if (authorStr)
        parts.push(authorStr);
    if (year)
        parts.push(`(${year})`);
    if (title)
        parts.push(`${title}.`);
    if (container) {
        let c = container;
        if (vol)
            c += ` ${vol}`;
        if (issue)
            c += `(${issue})`;
        if (pages)
            c += `, ${pages}`;
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
function enrichReference(ref) {
    const base = ref.raw?.trim()
        ? ref.raw
        : formatReferenceFromCsl(ref.cslJson);
    let html = linkifyText(base);
    const doiUrl = normalizeDoi(ref.doi) ?? normalizeUrl(ref.url);
    if (doiUrl && !html.includes(doiUrl)) {
        html += ` <a class="doi-link" href="${doiUrl}" rel="noopener">${escapeHtml(doiUrl)}</a>`;
    }
    return html;
}
/**
 * Render an in-text citation as a semantic, clickable anchor:
 *   <a href="#ref-<id>" id="cite-<id>" class="citation"
 *      data-citation-id="<id>" aria-label="Go to reference <n>">[15]</a>
 * `id="cite-<id>"` is assigned only on the first occurrence so the reference's
 * "↩ Back" link has a single stable target.
 */
function renderInTextCitation(cite, ctx) {
    const id = cite.citationId;
    const target = `ref-${escapeHtml(id)}`;
    const anchorId = ctx.seen.has(id)
        ? ""
        : ((ctx.seen.add(id), ` id="cite-${escapeHtml(id)}"`));
    const text = escapeHtml(cite.text ?? id);
    const n = ctx.refOrder?.get(id);
    const aria = n ? `Go to reference ${n}` : "Go to reference";
    return `<a href="#${target}"${anchorId} class="citation" data-citation-id="${escapeHtml(id)}" aria-label="${aria}">${text}</a>`;
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
function renderBibliographyEnriched(doc, ctx) {
    if (doc.references.length === 0)
        return "";
    const items = doc.references
        .map((r) => {
        const anchorId = `ref-${escapeHtml(r.id)}`;
        const doiAttr = normalizeDoi(r.doi)
            ? ` data-doi="${escapeHtml(normalizeDoi(r.doi))}"`
            : "";
        const body = enrichReference(r);
        const back = ctx.seen.has(r.id)
            ? ` <a href="#cite-${escapeHtml(r.id)}" class="back-ref" aria-label="Back to citation">↩ Back</a>`
            : "";
        return `<li id="${anchorId}" class="reference" data-citation-id="${escapeHtml(r.id)}"${doiAttr}>${body}${back}</li>`;
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
function buildCitationMetadata(doc) {
    const m = {};
    if (doc.metadata.title)
        m.title = doc.metadata.title;
    const authors = doc.metadata.authors
        .map((a) => (a.affiliation ? `${a.name} (${a.affiliation})` : a.name))
        .filter(Boolean);
    if (authors.length)
        m.author = authors.join("; ");
    if (doc.metadata.keywords.length)
        m.keywords = doc.metadata.keywords.join(", ");
    if (doc.metadata.abstract)
        m.abstract = doc.metadata.abstract;
    if (doc.metadata.date)
        m.date = doc.metadata.date;
    const lang = doc.settings.locale.split("-")[0];
    if (lang)
        m.lang = lang;
    return m;
}
function collectCitationIds(blocks) {
    const out = [];
    const walk = (node, blockIndex) => {
        if (Array.isArray(node)) {
            node.forEach((c) => walk(c, blockIndex));
            return;
        }
        if (node && typeof node === "object") {
            const o = node;
            if (o.type === "citation" && typeof o.citationId === "string") {
                out.push({ id: o.citationId, blockIndex });
            }
            for (const k of Object.keys(o)) {
                const v = o[k];
                if (Array.isArray(v))
                    v.forEach((c) => walk(c, blockIndex));
                else if (v && typeof v === "object")
                    walk(v, blockIndex);
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
function validateCitationLinks(doc) {
    const findings = [];
    const refIds = new Set(doc.references.map((r) => r.id));
    const seenIds = new Set();
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
