"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PandocOutputAdapter = exports.PandocUnavailableError = exports.CSL_INLINE_MARKER = void 0;
exports.isPandocAvailable = isPandocAvailable;
/**
 * Pandoc-backed output adapter (docx / latex / rtf / epub).
 *
 * Converts the CDM -> semantic HTML, then shells out to Pandoc. The runner is
 * injected so the adapter is unit-testable without a Pandoc binary present.
 *
 * Citation model: ColabWize owns citations. The incoming HTML already carries
 * the enriched, fully-linked bibliography (clickable DOIs/URLs, stable
 * `#ref-<id>` anchors, a "↩ Back" link per cited reference) plus document
 * metadata. Pandoc's only job here is to *convert* that HTML and preserve the
 * links/bookmarks/metadata — it is never asked to understand citations (no
 * `--citeproc`). When Pandoc is unavailable we degrade to the same semantic
 * HTML so the export still succeeds.
 */
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const jszip_1 = __importDefault(require("jszip"));
const html_1 = require("../../serializers/html");
const htmlCitation_1 = require("../../citations/htmlCitation");
const util_1 = require("./util");
exports.CSL_INLINE_MARKER = "--bibliography-data";
/**
 * Thrown when the `pandoc` binary cannot be found on the PATH. Callers (e.g. the
 * submission-package builder) catch this to fall back to pure-JS HTML rendering
 * so an export still succeeds instead of crashing with a cryptic `ENOENT`.
 */
class PandocUnavailableError extends Error {
    constructor() {
        super("Pandoc is not installed or not on the PATH. Install Pandoc " +
            "(https://pandoc.org/install.html) to export .docx/.pdf/.latex. " +
            "Falling back to HTML rendering.");
        this.name = "PandocUnavailableError";
    }
}
exports.PandocUnavailableError = PandocUnavailableError;
let _pandocAvailable = null;
/** Probe pandoc once and cache the result. */
async function isPandocAvailable() {
    if (_pandocAvailable !== null)
        return _pandocAvailable;
    try {
        await new Promise((resolve, reject) => {
            const c = (0, node_child_process_1.spawn)("pandoc", ["--version"]);
            c.on("error", () => reject(new Error("enoent")));
            c.on("close", (code) => (code === 0 ? resolve() : reject(new Error("bad"))));
        });
        _pandocAvailable = true;
    }
    catch {
        _pandocAvailable = false;
    }
    return _pandocAvailable;
}
const defaultRunner = {
    async run(args, input) {
        // Materialize any inline CSL-JSON bibliography (emitted as
        // `--bibliography-data <json>`) to a temp file so real Pandoc can read it
        // via `--bibliography <file>`. Stateless: each call writes its own file.
        const realArgs = [];
        let cslData;
        for (let i = 0; i < args.length; i += 1) {
            if (args[i] === exports.CSL_INLINE_MARKER) {
                cslData = args[i + 1];
                i += 1;
            }
            else {
                realArgs.push(args[i]);
            }
        }
        let cslFile;
        if (cslData) {
            cslFile = (0, node_path_1.join)((0, node_os_1.tmpdir)(), `cw-csl-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
            await (0, promises_1.writeFile)(cslFile, cslData, "utf8");
            realArgs.push("--bibliography", cslFile);
        }
        return new Promise((resolve, reject) => {
            const child = (0, node_child_process_1.spawn)("pandoc", realArgs);
            const chunks = [];
            child.stdout.on("data", (d) => chunks.push(Buffer.from(d)));
            child.stderr.on("data", () => {
                /* surface via exit code below */
            });
            child.on("error", (err) => {
                if (err.code === "ENOENT") {
                    reject(new PandocUnavailableError());
                }
                else {
                    reject(err);
                }
            });
            child.on("close", (code) => {
                if (cslFile) {
                    (0, promises_1.unlink)(cslFile).catch(() => { });
                }
                if (code === 0)
                    resolve(Buffer.concat(chunks));
                else
                    reject(new Error(`pandoc exited with code ${code ?? -1}`));
            });
            child.stdin.write(input);
            child.stdin.end();
        });
    },
};
class PandocOutputAdapter {
    format;
    supportedFormats;
    runner;
    constructor(opts) {
        this.format = opts.format;
        this.supportedFormats = opts.formats ?? [opts.format];
        this.runner = opts.runner ?? defaultRunner;
    }
    estimateComplexity() {
        return "fast";
    }
    async generate(doc, ctx) {
        const target = ctx.format ?? this.format;
        // HTML target: the serializer IS the HTML, so return it directly with the
        // embedded PRINT_CSS (in-text citations black, reference DOIs blue). This
        // guarantees a standalone .html export looks identical to the on-screen
        // preview instead of falling back to browser-default blue links.
        if (target === "html") {
            const html = (0, html_1.cdmToHtml)(doc, {
                fullDocument: true,
                placeholderLabels: ctx.placeholderLabels,
                citeproc: false,
            });
            return (0, util_1.buildResult)("html", Buffer.from(html, "utf8"));
        }
        // ColabWize owns citations: the HTML already carries the enriched, linked
        // bibliography, so Pandoc only converts (no --citeproc). This guarantees the
        // in-text `#ref-<id>` anchors survive as Word bookmarks / PDF links.
        const html = (0, html_1.cdmToHtml)(doc, {
            fullDocument: false,
            placeholderLabels: ctx.placeholderLabels,
            citeproc: false,
        });
        const args = ["-f", "html", "-t", target, "-o", "-"];
        // Carry document metadata into DOCX/PDF core properties (title, author,
        // keywords, abstract, date, language).
        const meta = (0, htmlCitation_1.buildCitationMetadata)(doc);
        for (const [key, value] of Object.entries(meta)) {
            args.push("-M", `${key}=${value}`);
        }
        // Word applies a single "Hyperlink" character style to every link — both
        // in-text citations and reference DOIs. The reference-doc gives "Hyperlink"
        // a standard blue+underline look (for the clickable DOIs/URLs), and defines
        // a black "CitationLink" style for in-text citations. We then post-process
        // the generated .docx to retarget internal (#anchor) links — the in-text
        // citations and the "↩ Back" jumps — onto CitationLink, so in-text
        // citations stay plain black while reference links remain blue. Optional —
        // export still works without the reference-doc (links just render
        // blue-underlined in Word for every link).
        const refDoc = resolveReferenceDoc();
        if (target === "docx" && refDoc) {
            args.push("--reference-doc", refDoc);
        }
        try {
            const buffer = await this.runner.run(args, html);
            if (target === "docx") {
                const styled = await applyDocxCitationStyling(buffer);
                return (0, util_1.buildResult)(target, styled);
            }
            return (0, util_1.buildResult)(target, buffer);
        }
        catch (e) {
            if (isPandocMissing(e)) {
                // Pandoc not installed: degrade to pure-JS HTML so the export still
                // succeeds instead of crashing with a cryptic `ENOENT`. The HTML already
                // carries the enriched bibliography, so it remains linked. Embed
                // PRINT_CSS so the fallback matches the on-screen preview styling
                // (in-text citations black, reference DOIs blue) rather than defaulting
                // to browser-blue links.
                const fallbackHtml = (0, html_1.cdmToHtml)(doc, {
                    fullDocument: true,
                    placeholderLabels: ctx.placeholderLabels,
                    citeproc: false,
                });
                return (0, util_1.buildResult)("html", Buffer.from(fallbackHtml, "utf8"));
            }
            throw e;
        }
    }
}
exports.PandocOutputAdapter = PandocOutputAdapter;
/**
 * Locate the committed Pandoc reference-doc used to give Word output
 * publication-clean hyperlink styling. Tries a path relative to this module and
 * a path relative to the repo root so it resolves in both dev (tsx) and the
 * compiled/dist layout. Returns `undefined` if not found — in which case the
 * adapter simply omits `--reference-doc` and export still succeeds.
 */
function resolveReferenceDoc() {
    const candidates = [
        (0, node_path_1.join)(__dirname, "..", "..", "..", "assets", "docx", "reference.docx"),
        (0, node_path_1.join)(process.cwd(), "src", "assets", "docx", "reference.docx"),
    ];
    return candidates.find((p) => (0, node_fs_1.existsSync)(p));
}
function isPandocMissing(e) {
    return (e instanceof PandocUnavailableError ||
        e?.code === "ENOENT" ||
        /pandoc/i.test(String(e?.message)));
}
/**
 * Post-process a generated .docx so in-text citations stay plain black while
 * reference DOIs/URLs remain blue. Word applies one "Hyperlink" character style
 * to every link (in-text + reference), so we retarget the *internal* (`#anchor`)
 * links — in-text citations and the "↩ Back" jumps — onto the black
 * "CitationLink" style defined in the reference-doc, leaving external links on
 * the blue "Hyperlink" style. Defensive: returns the input unchanged if it is
 * not a loadable .docx (e.g. a test mock or non-zip buffer).
 */
async function applyDocxCitationStyling(buffer) {
    try {
        const zip = await jszip_1.default.loadAsync(buffer);
        const docFile = zip.file("word/document.xml");
        if (!docFile)
            return buffer;
        const xml = await docFile.async("string");
        const out = xml.replace(/<w:hyperlink\b[^>]*\bw:anchor=[^>]*>([\s\S]*?)<\/w:hyperlink>/g, (block) => block.replace(/<w:rStyle\s+w:val="Hyperlink"\s*\/?>/g, '<w:rStyle w:val="CitationLink"/>'));
        if (out === xml)
            return buffer;
        zip.file("word/document.xml", out);
        return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    }
    catch {
        return buffer;
    }
}
