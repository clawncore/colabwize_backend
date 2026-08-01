"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAuditReport = buildAuditReport;
exports.buildSubmissionPackage = buildSubmissionPackage;
const ids_1 = require("./ids");
const xref_1 = require("./xref");
const assets_1 = require("./assets");
const quality_1 = require("./quality");
const profiles_1 = require("./profiles");
function para(text) {
    return { type: "paragraph", content: [{ type: "text", text }] };
}
function heading(text) {
    return { type: "heading", level: 2, content: [{ type: "text", text }] };
}
function horizontalRule() {
    return { type: "horizontalRule" };
}
function subDoc(doc, body) {
    return {
        schemaVersion: "1.0",
        metadata: doc.metadata,
        settings: doc.settings,
        body,
        references: [],
        assets: [],
    };
}
/**
 * Render a (sub-)document via the engine, but degrade gracefully when Pandoc is
 * unavailable: instead of crashing the whole export with `spawn pandoc ENOENT`,
 * fall back to the pure-JS `cdmToHtml` serializer and return HTML. This keeps the
 * submission package complete (a usable zip with everything inside) even on
 * machines without Pandoc installed. `warnings` is appended to so callers can
 * surface the fallback in the audit report.
 *
 * Citations are always self-rendered into the HTML (ColabWize owns citations;
 * Pandoc only converts), so citeproc is never enabled here.
 */
async function renderWithFallback(doc, deps, format, cslStyle, opts = {}) {
    // The engine's Pandoc adapter falls back to pure-JS HTML when Pandoc is not
    // installed, returning `format: "html"`. We honor whatever it returns (so the
    // file extension + mime stay correct) and record a warning when it degraded.
    // `enableCiteproc` is always false: the bibliography is pre-rendered into the
    // HTML as a rich, linked list so its anchors survive the conversion.
    const res = await deps.engine.generate(doc, {
        format,
        cslStyle,
        enableCiteproc: false,
        placeholderLabels: opts.placeholderLabels,
    });
    const ext = res.format === "latex" ? "tex" : res.format === "pdf" ? "pdf" : res.format === "html" ? "html" : "docx";
    if (ext !== format && format !== "html") {
        opts.warnings?.push(`Pandoc unavailable — rendered "${format}" content as .${ext} instead. ` +
            `Install Pandoc (https://pandoc.org/install.html) for true .${format} output.`);
    }
    return { bytes: res.buffer, mime: res.mimeType, ext };
}
/* ----------------------------- BibTeX export ----------------------------- */
function str(v) {
    return typeof v === "string" ? v : undefined;
}
function cslYear(csl) {
    const issued = csl.issued;
    const parts = issued?.["date-parts"];
    if (parts?.[0]?.[0])
        return String(parts[0][0]);
    const y = csl.year ?? issued?.year;
    return typeof y === "number" || typeof y === "string" ? String(y) : undefined;
}
function bibType(cslType) {
    const map = {
        article: "article",
        book: "book",
        chapter: "inbook",
        "paper-conference": "inproceedings",
        proceedings: "proceedings",
        webpage: "misc",
        thesis: "phdthesis",
        report: "techreport",
        entry: "misc",
    };
    return (typeof cslType === "string" && map[cslType]) || "misc";
}
function sanitizeKey(id) {
    return id.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase().slice(0, 60);
}
function toBibtex(refs) {
    return refs
        .map((r) => {
        const csl = (r.cslJson ?? {});
        if (Object.keys(csl).length === 0) {
            return `% ${r.id}\n% (no CSL-JSON available)`;
        }
        const type = bibType(csl.type);
        const key = sanitizeKey(r.id);
        const fields = [];
        const push = (name, value) => {
            if (value)
                fields.push(`  ${name} = {${value.replace(/[{}]/g, "")}}`);
        };
        push("title", str(csl.title));
        const authors = Array.isArray(csl.author)
            ? csl.author
                .map((a) => `${str(a.family) ?? ""}, ${str(a.given) ?? ""}`.trim())
                .filter(Boolean)
            : [];
        if (authors.length)
            push("author", authors.join(" and "));
        push("journal", str(csl["container-title"]));
        push("publisher", str(csl.publisher));
        push("volume", str(csl.volume));
        push("number", str(csl.issue));
        push("pages", str(csl.page));
        push("year", cslYear(csl));
        push("doi", str(csl.DOI) ?? str(csl.doi));
        push("url", str(csl.URL) ?? str(csl.url));
        return `@${type}{${key},\n${fields.join(",\n")}\n}`;
    })
        .join("\n\n");
}
/* ------------------------------- Audit report ----------------------------- */
function buildAuditReport(index, findings) {
    return {
        summary: {
            figures: index.figures.length,
            tables: index.tables.length,
            equations: index.equations.length,
            references: index.references.length,
            errors: findings.filter((f) => f.severity === "error").length,
            warnings: findings.filter((f) => f.severity === "warning").length,
            infos: findings.filter((f) => f.severity === "info").length,
        },
        findings,
    };
}
function auditToMarkdown(report, systemWarnings = []) {
    const s = report.summary;
    const lines = [];
    lines.push("# Export Audit Report", "");
    lines.push(`- **Figures:** ${s.figures}`);
    lines.push(`- **Tables:** ${s.tables}`);
    lines.push(`- **Equations:** ${s.equations}`);
    lines.push(`- **References:** ${s.references}`);
    lines.push(`- **Errors:** ${s.errors}`);
    lines.push(`- **Warnings:** ${s.warnings}`);
    lines.push(`- **Info:** ${s.infos}`);
    lines.push("", "## Findings", "");
    if (report.findings.length === 0) {
        lines.push("No issues found.");
    }
    else {
        for (const f of report.findings) {
            lines.push(`- [${f.severity.toUpperCase()}] ${f.code}: ${f.message}`);
        }
    }
    if (systemWarnings.length > 0) {
        lines.push("", "## System Warnings", "");
        for (const w of systemWarnings)
            lines.push(`- ${w}`);
    }
    return lines.join("\n");
}
/* ------------------------------- Main builder ----------------------------- */
async function buildSubmissionPackage(doc, profileOrId, settings, deps) {
    const profile = typeof profileOrId === "string" ? (0, profiles_1.getPublisherProfile)(profileOrId) : profileOrId;
    const figurePlacement = settings.placement?.figures ?? profile.figurePlacement;
    const tablePlacement = settings.placement?.tables ?? profile.tablePlacement;
    const targetFormat = settings.targetFormat ?? "docx";
    const warnings = [];
    // ColabWize bookkeeping/integrity files (manifest, metadata, audit report,
    // references) are for the author — off by default? No: keep them on unless the
    // caller explicitly opts out, so the audit trail is preserved by default.
    const includeAudit = settings.includeAuditFiles !== false;
    // 1. Stable ids
    const { doc: augmented } = (0, ids_1.assignStableIds)(doc);
    // 2. Cross-reference index + validation findings
    const { index, findings } = (0, xref_1.buildCrossReferenceIndex)(augmented);
    // 3. Asset extraction + quality
    const assets = await (0, assets_1.extractAssets)(augmented, deps.extractAssetsOptions);
    const assetById = new Map(assets.map((a) => [a.id, a]));
    for (const a of assets)
        findings.push(...(0, quality_1.checkImageQuality)(a, profile));
    // 4. Manuscript (with placeholder tokens for non-inline objects)
    const manuscriptLabels = {};
    if (figurePlacement !== "inline") {
        for (const e of index.figures)
            manuscriptLabels[e.internalId] = profile.placeholderStyle("figure", e.displayNumber);
    }
    if (tablePlacement !== "inline") {
        for (const e of index.tables)
            manuscriptLabels[e.internalId] = profile.placeholderStyle("table", e.displayNumber);
    }
    const manuscript = await renderWithFallback(augmented, deps, targetFormat, profile.cslStyle, {
        citeproc: false,
        placeholderLabels: manuscriptLabels,
        warnings,
    });
    const files = [
        { path: `Manuscript.${manuscript.ext}`, bytes: manuscript.bytes, mime: manuscript.mime },
    ];
    // 5. Figures document
    if (index.figures.length > 0) {
        const figBlocks = [];
        for (const e of index.figures) {
            const fig = findFigure(augmented, e.internalId);
            if (fig)
                figBlocks.push(fig);
            const asset = assetById.get(e.internalId);
            figBlocks.push(heading(e.displayNumber));
            figBlocks.push(para(`ID: ${e.internalId}`));
            if (e.caption)
                figBlocks.push(para(`Caption: ${e.caption}`));
            const res = asset && asset.bytes
                ? `${asset.width ?? "?"}x${asset.height ?? "?"} px${asset.dpi ? `, ${asset.dpi} dpi` : ""}`
                : "unresolved";
            figBlocks.push(para(`Resolution: ${res}`));
            figBlocks.push(para(`Original source: ${asset?.src ?? "n/a"}`));
            figBlocks.push(horizontalRule());
        }
        const fig = await renderWithFallback(subDoc(augmented, figBlocks), deps, targetFormat, profile.cslStyle, { warnings });
        files.push({ path: `Figures.${fig.ext}`, bytes: fig.bytes, mime: fig.mime });
    }
    // 6. Tables document
    if (index.tables.length > 0) {
        const tabBlocks = [];
        for (const e of index.tables) {
            const tbl = findTable(augmented, e.internalId);
            if (tbl)
                tabBlocks.push(heading(e.displayNumber), tbl, horizontalRule());
        }
        const tab = await renderWithFallback(subDoc(augmented, tabBlocks), deps, targetFormat, profile.cslStyle, { warnings });
        files.push({ path: `Tables.${tab.ext}`, bytes: tab.bytes, mime: tab.mime });
    }
    // 7. References (ColabWize bookkeeping — gated by includeAuditFiles)
    if (includeAudit) {
        const hasCsl = doc.references.some((r) => r.cslJson && Object.keys(r.cslJson).length > 0);
        if (hasCsl) {
            files.push({
                path: "References.bib",
                bytes: Buffer.from(toBibtex(doc.references), "utf8"),
                mime: "application/x-bibtex",
            });
        }
        else if (doc.references.length > 0) {
            const txt = doc.references.map((r) => r.raw ?? r.id).join("\n\n");
            files.push({ path: "References.txt", bytes: Buffer.from(txt, "utf8"), mime: "text/plain" });
        }
    }
    // 8. Metadata.json (ColabWize bookkeeping — gated by includeAuditFiles)
    if (includeAudit) {
        const metadata = {
            ...augmented.metadata,
            profileId: profile.id,
            generatedAt: new Date().toISOString(),
        };
        files.push({
            path: "Metadata.json",
            bytes: Buffer.from(JSON.stringify(metadata, null, 2), "utf8"),
            mime: "application/json",
        });
    }
    // 9. Manifest.json
    const manifest = {
        title: augmented.metadata.title,
        generatedAt: new Date().toISOString(),
        profileId: profile.id,
        figures: index.figures.map((e) => {
            const asset = assetById.get(e.internalId);
            return {
                id: e.internalId,
                displayNumber: e.displayNumber,
                caption: e.caption,
                referenced: e.referenced,
                filename: asset?.bytes && asset.ext ? `Images/${e.internalId}.${asset.ext}` : undefined,
            };
        }),
        tables: index.tables.map((e) => ({
            id: e.internalId,
            displayNumber: e.displayNumber,
            referenced: e.referenced,
        })),
        equations: index.equations.map((e) => ({
            id: e.internalId,
            displayNumber: e.displayNumber,
            referenced: e.referenced,
        })),
        references: index.references.map((r) => ({ id: r.id, cited: r.cited })),
        assets: assets.map((a) => ({
            id: a.id,
            filename: a.bytes && a.ext ? `Images/${a.id}.${a.ext}` : undefined,
            mime: a.mime,
            warnings: a.warnings,
        })),
    };
    if (includeAudit) {
        files.push({
            path: "manifest.json",
            bytes: Buffer.from(JSON.stringify(manifest, null, 2), "utf8"),
            mime: "application/json",
        });
    }
    // 10. Cover letter
    if (profile.coverPage) {
        const authors = augmented.metadata.authors.map((a) => a.name).join(", ");
        const coverBlocks = [
            heading("Cover Letter"),
            para("Dear Editor,"),
            para(augmented.metadata.title
                ? `Please find enclosed our submission entitled "${augmented.metadata.title}".`
                : "Please find enclosed our submission."),
            para(`Prepared for ${profile.label} as a publisher-compliant submission package.`),
            para("Sincerely,"),
            para(authors || "The Authors"),
        ];
        const cover = await renderWithFallback(subDoc(augmented, coverBlocks), deps, "docx", profile.cslStyle, { warnings });
        files.push({ path: `CoverLetter.${cover.ext}`, bytes: cover.bytes, mime: cover.mime });
    }
    // 11. Audit report (ColabWize bookkeeping — gated by includeAuditFiles)
    // The report object is always built (it's part of the returned package
    // metadata); only emitting it as a file in the zip is gated by includeAudit.
    const audit = buildAuditReport(manifest, findings);
    if (includeAudit) {
        files.push({
            path: "ExportReport.md",
            bytes: Buffer.from(auditToMarkdown(audit, warnings), "utf8"),
            mime: "text/markdown",
        });
    }
    // 12. Images folder
    for (const a of assets) {
        if (a.bytes && a.ext) {
            files.push({
                path: `Images/${a.id}.${a.ext}`,
                bytes: a.bytes,
                mime: a.mime ?? "application/octet-stream",
            });
        }
    }
    return { files, manifest, audit };
}
/* ------------------------------- helpers ---------------------------------- */
function findFigure(doc, id) {
    let found;
    const visit = (blocks) => {
        for (const b of blocks) {
            if (found)
                return;
            if (b.type === "figure" && b.id === id) {
                found = b;
                return;
            }
            if (b.type === "bulletList" || b.type === "orderedList")
                for (const it of b.items)
                    visit(it.content);
            if (b.type === "blockquote" || b.type === "appendix")
                visit(b.content);
            if (b.type === "table")
                for (const row of b.rows)
                    for (const cell of row.cells)
                        visit(cell.content);
        }
    };
    visit(doc.body);
    return found;
}
function findTable(doc, id) {
    let found;
    const visit = (blocks) => {
        for (const b of blocks) {
            if (found)
                return;
            if (b.type === "table" && b.id === id) {
                found = b;
                return;
            }
            if (b.type === "bulletList" || b.type === "orderedList")
                for (const it of b.items)
                    visit(it.content);
            if (b.type === "blockquote" || b.type === "appendix")
                visit(b.content);
            if (b.type === "table")
                for (const row of b.rows)
                    for (const cell of row.cells)
                        visit(cell.content);
        }
    };
    visit(doc.body);
    return found;
}
