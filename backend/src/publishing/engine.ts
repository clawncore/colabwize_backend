/**
 * Publishing Engine (Phase 2).
 *
 * Single orchestration entry point for generating a document from a Canonical
 * Document Model. It selects the appropriate output adapter by format and
 * returns a GenResult (artifact + metadata). Billing, jobs, validation gating
 * and destinations are layered on in later phases; this engine is pure and
 * independently testable.
 */
import { CanonicalDocument, OutputFormat } from "./cdm";
import { GenCtx, GenResult, OutputAdapter } from "./types";
import type { PpeSettings } from "./ppe/types";
import { PandocOutputAdapter } from "./adapters/output/pandocAdapter";
import { PuppeteerPdfAdapter } from "./adapters/output/puppeteerPdfAdapter";
import { HtmlOutputAdapter } from "./adapters/output/htmlAdapter";
import { MarkdownOutputAdapter } from "./adapters/output/markdownAdapter";
import { PlainTextAdapter } from "./adapters/output/textAdapter";
import { SubmissionPackageAdapter } from "./ppe/adapter";

export interface GenerateOptions {
  format: OutputFormat;
  cslStyle?: string;
  templateId?: string;
  enableCiteproc?: boolean;
  placeholderLabels?: Record<string, string>;
  ppe?: PpeSettings;
}

export class PublishingEngine {
  private adapters = new Map<OutputFormat, OutputAdapter>();

  constructor(adapters?: OutputAdapter[]) {
    for (const a of adapters ?? PublishingEngine.defaultAdapters()) {
      this.register(a);
    }
  }

  static defaultAdapters(): OutputAdapter[] {
    return [
      new PandocOutputAdapter({
        format: "docx",
        formats: ["docx", "latex", "rtf", "epub"],
      }),
      new PuppeteerPdfAdapter(),
      new HtmlOutputAdapter(),
      new MarkdownOutputAdapter(),
      new PlainTextAdapter(),
    ];
  }

  register(adapter: OutputAdapter): void {
    for (const f of adapter.supportedFormats) {
      this.adapters.set(f, adapter);
    }
  }

  getAdapter(format: OutputFormat): OutputAdapter | undefined {
    return this.adapters.get(format);
  }

  async generate(
    doc: CanonicalDocument,
    opts: GenerateOptions,
  ): Promise<GenResult> {
    // Lazily register the submission adapter (avoids a module-load cycle with
    // engine.ts, since the adapter references the shared engine instance).
    if (opts.format === "submission" && !this.adapters.has("submission")) {
      this.register(new SubmissionPackageAdapter());
    }
    const adapter = this.adapters.get(opts.format);
    if (!adapter) {
      throw new Error(
        `No output adapter registered for format "${opts.format}".`,
      );
    }
    const ctx: GenCtx = {
      format: opts.format,
      cslStyle: opts.cslStyle ?? doc.settings.cslStyle,
      templateId: opts.templateId,
      title: doc.metadata.title,
      enableCiteproc: opts.enableCiteproc,
      placeholderLabels: opts.placeholderLabels,
      ppe: opts.ppe,
    };
    return adapter.generate(doc, ctx);
  }
}

/** Shared engine instance with the default adapter registry. */
export const publishingEngine = new PublishingEngine();

export function generateDocument(
  doc: CanonicalDocument,
  opts: GenerateOptions,
): Promise<GenResult> {
  return publishingEngine.generate(doc, opts);
}
