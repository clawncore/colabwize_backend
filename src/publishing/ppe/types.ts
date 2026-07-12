/**
 * Publication Export Engine (PPE) — shared types.
 *
 * The PPE turns the Publishing Platform's single-artifact export into a
 * publisher-compliant *submission package* (a ZIP of Manuscript/Figures/Tables/
 * References/Metadata/manifest/cover-letter/audit). These types describe the
 * request settings, the cross-reference index, validation findings, and the
 * files that make up a package. Pure data — no runtime dependencies.
 */

/** Where a float of content is placed in the package. */
export type PlacementMode =
  | "inline" // keep in the manuscript where it appears
  | "end" // move to the end of the manuscript
  | "separate-doc" // its own document (Figures.docx / Tables.docx)
  | "separate-folder" // extracted binaries in Images/ (figures only)
  | "placeholder" // replaced by a token like <<FIGURE_001>>
  | "appendix"; // collected in an appendix section

export type ImageFormat = "png" | "tiff" | "jpg" | "jpeg" | "svg" | "pdf";

export type PpeMode = "standard" | "publication";

/** Per-job configuration for a publication export. */
export interface PpeSettings {
  mode?: PpeMode;
  /** Publisher profile id (e.g. "nature", "ieee"). Defaults to "generic". */
  profileId?: string;
  placement?: {
    figures?: PlacementMode;
    tables?: PlacementMode;
  };
  /** Inner target format for the manuscript document. */
  targetFormat?: "docx" | "latex" | "pdf";
  /** Preferred raster/vector format for extracted figures. */
  imageFormat?: ImageFormat;
  /** Minimum DPI the profile expects (quality gate). */
  dpi?: number;
  columnLayout?: 1 | 2;
  /**
   * Include ColabWize's bookkeeping/integrity files in `Submission.zip`
   * (`manifest.json`, `Metadata.json`, `ExportReport.md`, `References.bib`/`.txt`).
   * These are for the author's audit trail, not the journal — turn off for a
   * clean, journal-only package. Defaults to `true`.
   */
  includeAuditFiles?: boolean;
}

/** A single indexed object (figure/table/equation) with its display label. */
export interface XrefEntry {
  /** Stable internal id, e.g. "FIG-2026-0001". */
  internalId: string;
  /** Human display number, e.g. "Figure 1". */
  displayNumber: string;
  /** Display label used in prose, e.g. "Figure 1". */
  displayLabel: string;
  /** Position in the document body (0-based index). */
  blockIndex: number;
  /** Whether the object is mentioned in the prose. */
  referenced: boolean;
  caption?: string;
}

export interface XrefCitation {
  citationId: string;
  resolved: boolean; // a matching Reference exists
  referenced: boolean; // appears in the body
}

export interface XrefReference {
  id: string;
  cited: boolean; // appears in the body
  missingDoi?: boolean;
  missingYear?: boolean;
  duplicate?: boolean;
}

/** Cross-reference index derived from a CDM. */
export interface CrossReferenceIndex {
  figures: XrefEntry[];
  tables: XrefEntry[];
  equations: XrefEntry[];
  citations: XrefCitation[];
  references: XrefReference[];
}

export type FindingSeverity = "error" | "warning" | "info";

/** A validation/audit finding surfaced in the export report. */
export interface ExportFinding {
  severity: FindingSeverity;
  code: string;
  message: string;
  locator?: {
    kind: string;
    id?: string;
    blockIndex?: number;
  };
}

/** One file inside the submission package. */
export interface PackageFile {
  /** Zip path, e.g. "Manuscript.docx" or "Images/figure1.tif". */
  path: string;
  bytes: Buffer;
  mime: string;
}

/** Manifest describing every object in the package (machine-readable). */
export interface PackageManifest {
  title?: string;
  generatedAt: string;
  profileId: string;
  figures: Array<{
    id: string;
    displayNumber: string;
    caption?: string;
    filename?: string;
    referenced: boolean;
  }>;
  tables: Array<{
    id: string;
    displayNumber: string;
    caption?: string;
    referenced: boolean;
  }>;
  equations: Array<{ id: string; displayNumber: string; referenced: boolean }>;
  references: Array<{ id: string; cited: boolean }>;
  assets: Array<{ id: string; filename?: string; mime?: string; warnings: string[] }>;
}

/** Roll-up audit report. */
export interface AuditReport {
  summary: {
    figures: number;
    tables: number;
    equations: number;
    references: number;
    errors: number;
    warnings: number;
    infos: number;
  };
  findings: ExportFinding[];
}

/** Result of building a package (before zipping). */
export interface BuiltPackage {
  files: PackageFile[];
  manifest: PackageManifest;
  audit: AuditReport;
}
