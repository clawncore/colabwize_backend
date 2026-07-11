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
import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cdmToHtml } from "../../serializers/html";
import { buildCitationMetadata } from "../../citations/htmlCitation";
import { CanonicalDocument, OutputFormat } from "../../cdm";
import {
  AdapterComplexity,
  GenCtx,
  GenResult,
  OutputAdapter,
} from "../../types";
import { buildResult } from "./util";

export const CSL_INLINE_MARKER = "--bibliography-data";

/**
 * Thrown when the `pandoc` binary cannot be found on the PATH. Callers (e.g. the
 * submission-package builder) catch this to fall back to pure-JS HTML rendering
 * so an export still succeeds instead of crashing with a cryptic `ENOENT`.
 */
export class PandocUnavailableError extends Error {
  constructor() {
    super(
      "Pandoc is not installed or not on the PATH. Install Pandoc " +
        "(https://pandoc.org/install.html) to export .docx/.pdf/.latex. " +
        "Falling back to HTML rendering.",
    );
    this.name = "PandocUnavailableError";
  }
}

let _pandocAvailable: boolean | null = null;

/** Probe pandoc once and cache the result. */
export async function isPandocAvailable(): Promise<boolean> {
  if (_pandocAvailable !== null) return _pandocAvailable;
  try {
    await new Promise<void>((resolve, reject) => {
      const c = spawn("pandoc", ["--version"]);
      c.on("error", () => reject(new Error("enoent")));
      c.on("close", (code) => (code === 0 ? resolve() : reject(new Error("bad"))));
    });
    _pandocAvailable = true;
  } catch {
    _pandocAvailable = false;
  }
  return _pandocAvailable;
}

export interface PandocRunner {
  run(args: string[], input: string): Promise<Buffer>;
}

const defaultRunner: PandocRunner = {
  async run(args: string[], input: string): Promise<Buffer> {
    // Materialize any inline CSL-JSON bibliography (emitted as
    // `--bibliography-data <json>`) to a temp file so real Pandoc can read it
    // via `--bibliography <file>`. Stateless: each call writes its own file.
    const realArgs: string[] = [];
    let cslData: string | undefined;
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === CSL_INLINE_MARKER) {
        cslData = args[i + 1];
        i += 1;
      } else {
        realArgs.push(args[i]);
      }
    }
    let cslFile: string | undefined;
    if (cslData) {
      cslFile = join(tmpdir(), `cw-csl-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      await writeFile(cslFile, cslData, "utf8");
      realArgs.push("--bibliography", cslFile);
    }
    return new Promise<Buffer>((resolve, reject) => {
      const child = spawn("pandoc", realArgs);
      const chunks: Buffer[] = [];
      child.stdout.on("data", (d: Buffer) => chunks.push(Buffer.from(d)));
      child.stderr.on("data", () => {
        /* surface via exit code below */
      });
      child.on("error", (err) => {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new PandocUnavailableError());
        } else {
          reject(err);
        }
      });
      child.on("close", (code) => {
        if (cslFile) {
          unlink(cslFile).catch(() => {});
        }
        if (code === 0) resolve(Buffer.concat(chunks));
        else reject(new Error(`pandoc exited with code ${code ?? -1}`));
      });
      child.stdin.write(input);
      child.stdin.end();
    });
  },
};

export class PandocOutputAdapter implements OutputAdapter {
  format: OutputFormat;
  supportedFormats: OutputFormat[];
  private runner: PandocRunner;

  constructor(opts: {
    format: OutputFormat;
    formats?: OutputFormat[];
    runner?: PandocRunner;
  }) {
    this.format = opts.format;
    this.supportedFormats = opts.formats ?? [opts.format];
    this.runner = opts.runner ?? defaultRunner;
  }

  estimateComplexity(): AdapterComplexity {
    return "fast";
  }

  async generate(doc: CanonicalDocument, ctx: GenCtx): Promise<GenResult> {
    const target = ctx.format ?? this.format;
    // ColabWize owns citations: the HTML already carries the enriched, linked
    // bibliography, so Pandoc only converts (no --citeproc). This guarantees the
    // in-text `#ref-<id>` anchors survive as Word bookmarks / PDF links.
    const html = cdmToHtml(doc, {
      fullDocument: false,
      placeholderLabels: ctx.placeholderLabels,
      citeproc: false,
    });

    const args: string[] = ["-f", "html", "-t", target, "-o", "-"];

    // Carry document metadata into DOCX/PDF core properties (title, author,
    // keywords, abstract, date, language).
    const meta = buildCitationMetadata(doc);
    for (const [key, value] of Object.entries(meta)) {
      args.push("-M", `${key}=${value}`);
    }

    // Publication-clean hyperlink styling for Word: a reference-doc whose
    // Hyperlink character style inherits body text (no blue underline) for
    // in-text citations, while DOI/URL links keep standard styling. Optional —
    // export still works without it (links just render blue-underlined in Word).
    const refDoc = resolveReferenceDoc();
    if (target === "docx" && refDoc) {
      args.push("--reference-doc", refDoc);
    }

    try {
      const buffer = await this.runner.run(args, html);
      return buildResult(target, buffer);
    } catch (e) {
      if (isPandocMissing(e)) {
        // Pandoc not installed: degrade to pure-JS HTML so the export still
        // succeeds instead of crashing with a cryptic `ENOENT`. The HTML already
        // carries the enriched bibliography, so it remains linked.
        const fallbackHtml = cdmToHtml(doc, {
          fullDocument: false,
          placeholderLabels: ctx.placeholderLabels,
          citeproc: false,
        });
        return buildResult("html", Buffer.from(fallbackHtml, "utf8"));
      }
      throw e;
    }
  }
}

/**
 * Locate the committed Pandoc reference-doc used to give Word output
 * publication-clean hyperlink styling. Tries a path relative to this module and
 * a path relative to the repo root so it resolves in both dev (tsx) and the
 * compiled/dist layout. Returns `undefined` if not found — in which case the
 * adapter simply omits `--reference-doc` and export still succeeds.
 */
function resolveReferenceDoc(): string | undefined {
  const candidates = [
    join(__dirname, "..", "..", "..", "assets", "docx", "reference.docx"),
    join(process.cwd(), "src", "assets", "docx", "reference.docx"),
  ];
  return candidates.find((p) => existsSync(p));
}

function isPandocMissing(e: unknown): boolean {
  return (
    e instanceof PandocUnavailableError ||
    (e as NodeJS.ErrnoException)?.code === "ENOENT" ||
    /pandoc/i.test(String((e as Error)?.message))
  );
}
