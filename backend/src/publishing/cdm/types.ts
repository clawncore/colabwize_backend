/**
 * Canonical Document Model (CDM) — the single semantic intermediate representation
 * that every Publishing Platform output adapter consumes.
 *
 * Design notes:
 * - This model is semantic, NOT presentational. It deliberately avoids HTML so that
 *   citations, references, figures, equations and cross-references retain their meaning
 *   (the previous `prepareFinalHtml` regex approach lost this).
 * - No `any`. Unknown/unsupported source nodes are preserved via `*Unknown` variants and
 *   surfaced as `ValidationFinding`s so the UI can warn instead of silently dropping content.
 */

export type OutputFormat =
  | "pdf"
  | "docx"
  | "latex"
  | "html"
  | "rtf"
  | "md"
  | "epub"
  | "txt"
  | "submission";

export type CslStyle =
  | "apa"
  | "mla"
  | "chicago"
  | "ieee"
  | "harvard"
  | "nature"
  | "elsevier"
  | "springer"
  | "acm"
  | "cvpr"
  | "neurips"
  | "icml"
  | (string & {}); // open-ended for future styles

export type InlineMarkType =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "link"
  | "highlight"
  | "superscript"
  | "subscript";

export interface DocAuthor {
  name: string;
  affiliation?: string;
  orcid?: string;
}

export interface DocMetadata {
  title?: string;
  authors: DocAuthor[];
  abstract?: string;
  keywords: string[];
  runningHead?: string;
  date?: string; // ISO-8601
  course?: string;
  instructor?: string;
  doi?: string;
  license?: string;
}

export interface PageGeometry {
  size: "A4" | "letter" | "A5" | (string & {});
  margin: { top: string; bottom: string; left: string; right: string };
  columns: 1 | 2;
}

export interface DocNumbering {
  figures: boolean;
  tables: boolean;
  equations: boolean;
  headings: boolean;
}

export interface DocSettings {
  locale: string; // BCP-47, e.g. "en-US"
  direction: "ltr" | "rtl";
  cslStyle: CslStyle;
  templateId?: string;
  pageGeometry: PageGeometry;
  numbering: DocNumbering;
}

/* ----------------------------- Inline nodes ----------------------------- */

export interface InlineMark {
  type: InlineMarkType;
  href?: string; // link
  color?: string; // highlight
}

export interface TextRun {
  type: "text";
  text: string;
  marks?: InlineMark[];
}

export interface CitationRun {
  type: "citation";
  citationId: string;
  text?: string;
  url?: string;
  status?: string; // e.g. "resolved" | "unresolved"
}

export interface MathRun {
  type: "math";
  latex: string;
  block?: boolean;
}

export interface HardBreak {
  type: "hardBreak";
}

export interface InlineUnknown {
  type: "inlineUnknown";
  nodeType: string;
  raw: unknown;
}

export type InlineNode =
  | TextRun
  | CitationRun
  | MathRun
  | HardBreak
  | InlineUnknown;

/* ----------------------------- Block nodes ------------------------------ */

export interface Heading {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  content: InlineNode[];
  id?: string;
}

export interface Paragraph {
  type: "paragraph";
  content: InlineNode[];
}

export interface ListItem {
  type: "listItem";
  content: BlockNode[];
}

export interface BulletList {
  type: "bulletList";
  items: ListItem[];
}

export interface OrderedList {
  type: "orderedList";
  items: ListItem[];
  start?: number;
}

export interface BlockQuote {
  type: "blockquote";
  content: BlockNode[];
}

export interface CodeBlock {
  type: "codeBlock";
  text: string;
  language?: string;
  id?: string;
}

export interface HorizontalRule {
  type: "horizontalRule";
}

export interface TableCell {
  type: "tableCell";
  content: BlockNode[];
  colspan?: number;
  rowspan?: number;
  isHeader?: boolean;
}

export interface TableRow {
  type: "tableRow";
  cells: TableCell[];
  isHeader?: boolean;
}

export interface Table {
  type: "table";
  rows: TableRow[];
  id?: string;
}

export interface Figure {
  type: "figure";
  src?: string;
  alt?: string;
  title?: string;
  width?: string | number;
  caption?: BlockNode[];
  span?: string;
  style?: string;
  assetId?: string;
  id?: string;
}

export interface Equation {
  type: "equation";
  latex: string;
  label?: string;
  numbered?: boolean;
  id?: string;
}

export interface PageBreak {
  type: "pageBreak";
}

export interface Appendix {
  type: "appendix";
  title?: string;
  content: BlockNode[];
}

export interface BlockUnknown {
  type: "blockUnknown";
  nodeType: string;
  raw: unknown;
}

export type BlockNode =
  | Heading
  | Paragraph
  | BulletList
  | OrderedList
  | BlockQuote
  | CodeBlock
  | HorizontalRule
  | Table
  | Figure
  | Equation
  | PageBreak
  | Appendix
  | BlockUnknown;

/* --------------------------- References & assets ------------------------- */

export interface Reference {
  id: string; // citationId
  cslJson?: Record<string, unknown>; // resolved CSL-JSON when available
  raw?: string; // raw bibliography text
  url?: string;
  doi?: string;
  refText?: string;
}

export interface Asset {
  id: string;
  sha256?: string;
  mime?: string;
  storageKey?: string;
  width?: number;
  caption?: string;
}

/* ------------------------------- Findings ------------------------------- */

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationFinding {
  severity: ValidationSeverity;
  code: string;
  message: string;
  locator?: {
    blockIndex?: number;
    nodeType?: string;
    citationId?: string;
  };
}

/* ----------------------------- Root document ---------------------------- */

export interface CanonicalDocument {
  schemaVersion: "1.0";
  metadata: DocMetadata;
  settings: DocSettings;
  body: BlockNode[];
  references: Reference[];
  assets: Asset[];
  annotations?: ValidationFinding[];
}

/* ------------------------------- Helpers -------------------------------- */

export function defaultCanonicalSettings(
  overrides: Partial<DocSettings> = {},
): DocSettings {
  return {
    locale: "en-US",
    direction: "ltr",
    cslStyle: "apa",
    pageGeometry: {
      size: "A4",
      margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
      columns: 1,
    },
    numbering: { figures: true, tables: true, equations: true, headings: true },
    ...overrides,
  };
}

export function defaultCanonicalMetadata(
  overrides: Partial<DocMetadata> = {},
): DocMetadata {
  return {
    authors: [],
    keywords: [],
    ...overrides,
  };
}
