/**
 * Publishing Platform — engine-level types (Phase 2).
 *
 * These describe the contract between the Publishing Engine and the output
 * adapters. They are deliberately decoupled from any specific converter
 * (Pandoc, Puppeteer, …) so adapters can be tested in isolation.
 */
import type { CanonicalDocument, OutputFormat } from "./cdm";
import type { PpeSettings } from "./ppe/types";

/** Relative cost of generating a document in a given format. */
export type AdapterComplexity = "fast" | "slow";

/** Result returned by every output adapter. */
export interface GenResult {
  format: OutputFormat;
  buffer: Buffer;
  mimeType: string;
  sizeBytes: number;
  /** sha-256 of the artifact, for integrity + idempotency in Phase 3. */
  checksum: string;
}

/** Context passed to an adapter when generating. */
export interface GenCtx {
  /** Resolved target format (may differ from the adapter's primary format). */
  format?: OutputFormat;
  cslStyle?: string;
  templateId?: string;
  title?: string;
  /**
   * When set, block nodes whose `id` is present in this map are rendered as the
   * mapped placeholder token instead of inline. Used by the Publication Export
   * Engine to keep figures/tables/equations out of the manuscript.
   */
  placeholderLabels?: Record<string, string>;
  /**
   * When true, the adapter may invoke a CSL processor (e.g. Pandoc citeproc)
   * for true citation-style compliance. Requires CSL-JSON references, which the
   * Template Engine (Phase 4) supplies; defaults to false for Phase 2 where the
   * bibliography is pre-rendered into the document.
   */
  enableCiteproc?: boolean;
  /** Publication Export Engine settings (submission packages). */
  ppe?: PpeSettings;
}

/**
 * Every output format implements this interface. Adapters must be independently
 * testable: any heavy/blocking work (spawning a binary, launching a browser)
 * should be injected so unit tests can run without those dependencies.
 */
export interface OutputAdapter {
  /** Primary format this adapter is registered for. */
  format: OutputFormat;
  /** All formats this single adapter can produce. */
  supportedFormats: OutputFormat[];
  estimateComplexity(doc: CanonicalDocument): AdapterComplexity;
  generate(doc: CanonicalDocument, ctx: GenCtx): Promise<GenResult>;
}

export const MIME_TYPES: Record<OutputFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  latex: "application/x-tex",
  html: "text/html",
  rtf: "application/rtf",
  md: "text/markdown",
  epub: "application/epub+zip",
  txt: "text/plain",
  submission: "application/zip",
};
