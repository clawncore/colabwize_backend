/**
 * Zod schema for the Canonical Document Model.
 *
 * Used by the Publishing Engine for runtime validation of a generated CDM and by
 * tests. Mirrors `types.ts`. Unknown/unsupported source nodes are carried as
 * `raw: z.unknown()` so validation never throws on third-party content.
 */
import { z } from "zod";

export const inlineMarkSchema = z.object({
  type: z.enum([
    "bold",
    "italic",
    "underline",
    "strike",
    "code",
    "link",
    "highlight",
    "superscript",
    "subscript",
  ]),
  href: z.string().url().optional(),
  color: z.string().optional(),
});

export const textRunSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
  marks: z.array(inlineMarkSchema).optional(),
});

export const citationRunSchema = z.object({
  type: z.literal("citation"),
  citationId: z.string(),
  text: z.string().optional(),
  url: z.string().optional(),
  status: z.string().optional(),
});

export const mathRunSchema = z.object({
  type: z.literal("math"),
  latex: z.string(),
  block: z.boolean().optional(),
});

export const hardBreakSchema = z.object({ type: z.literal("hardBreak") });

export const inlineUnknownSchema = z.object({
  type: z.literal("inlineUnknown"),
  nodeType: z.string(),
  raw: z.unknown(),
});

export const inlineNodeSchema = z.union([
  textRunSchema,
  citationRunSchema,
  mathRunSchema,
  hardBreakSchema,
  inlineUnknownSchema,
]);

export const headingSchema = z.object({
  type: z.literal("heading"),
  level: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
    z.literal(5),
    z.literal(6),
  ]),
  content: z.array(inlineNodeSchema),
  id: z.string().optional(),
});

export const paragraphSchema = z.object({
  type: z.literal("paragraph"),
  content: z.array(inlineNodeSchema),
});

export const listItemSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({ type: z.literal("listItem"), content: z.array(blockNodeSchema) }),
);

export const bulletListSchema = z.object({
  type: z.literal("bulletList"),
  items: z.array(listItemSchema),
});

export const orderedListSchema = z.object({
  type: z.literal("orderedList"),
  items: z.array(listItemSchema),
  start: z.number().optional(),
});

export const blockQuoteSchema = z.object({
  type: z.literal("blockquote"),
  content: z.array(z.lazy(() => blockNodeSchema)),
});

export const codeBlockSchema = z.object({
  type: z.literal("codeBlock"),
  text: z.string(),
  language: z.string().optional(),
  id: z.string().optional(),
});

export const horizontalRuleSchema = z.object({ type: z.literal("horizontalRule") });

export const tableCellSchema = z.object({
  type: z.literal("tableCell"),
  content: z.array(z.lazy(() => blockNodeSchema)),
  colspan: z.number().optional(),
  rowspan: z.number().optional(),
  isHeader: z.boolean().optional(),
});

export const tableRowSchema = z.object({
  type: z.literal("tableRow"),
  cells: z.array(tableCellSchema),
  isHeader: z.boolean().optional(),
});

export const tableSchema = z.object({
  type: z.literal("table"),
  rows: z.array(tableRowSchema),
  id: z.string().optional(),
});

export const figureSchema = z.object({
  type: z.literal("figure"),
  src: z.string().optional(),
  alt: z.string().optional(),
  title: z.string().optional(),
  width: z.union([z.string(), z.number()]).optional(),
  caption: z.array(z.lazy(() => blockNodeSchema)).optional(),
  span: z.string().optional(),
  style: z.string().optional(),
  assetId: z.string().optional(),
  id: z.string().optional(),
});

export const equationSchema = z.object({
  type: z.literal("equation"),
  latex: z.string(),
  label: z.string().optional(),
  numbered: z.boolean().optional(),
  id: z.string().optional(),
});

export const pageBreakSchema = z.object({ type: z.literal("pageBreak") });

export const appendixSchema = z.object({
  type: z.literal("appendix"),
  title: z.string().optional(),
  content: z.array(z.lazy(() => blockNodeSchema)),
});

export const blockUnknownSchema = z.object({
  type: z.literal("blockUnknown"),
  nodeType: z.string(),
  raw: z.unknown(),
});

export const blockNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    headingSchema,
    paragraphSchema,
    bulletListSchema,
    orderedListSchema,
    blockQuoteSchema,
    codeBlockSchema,
    horizontalRuleSchema,
    tableSchema,
    figureSchema,
    equationSchema,
    pageBreakSchema,
    appendixSchema,
    blockUnknownSchema,
  ]),
);

export const referenceSchema = z.object({
  id: z.string(),
  cslJson: z.record(z.string(), z.unknown()).optional(),
  raw: z.string().optional(),
  url: z.string().optional(),
  doi: z.string().optional(),
  refText: z.string().optional(),
});

export const assetSchema = z.object({
  id: z.string(),
  sha256: z.string().optional(),
  mime: z.string().optional(),
  storageKey: z.string().optional(),
  width: z.number().optional(),
  caption: z.string().optional(),
});

export const validationFindingSchema = z.object({
  severity: z.enum(["error", "warning", "info"]),
  code: z.string(),
  message: z.string(),
  locator: z
    .object({
      blockIndex: z.number().optional(),
      nodeType: z.string().optional(),
      citationId: z.string().optional(),
    })
    .optional(),
});

export const canonicalDocumentSchema = z.object({
  schemaVersion: z.literal("1.0"),
  metadata: z.object({
    title: z.string().optional(),
    authors: z.array(
      z.object({
        name: z.string(),
        affiliation: z.string().optional(),
        orcid: z.string().optional(),
      }),
    ),
    abstract: z.string().optional(),
    keywords: z.array(z.string()),
    runningHead: z.string().optional(),
    date: z.string().optional(),
    course: z.string().optional(),
    instructor: z.string().optional(),
    doi: z.string().optional(),
    license: z.string().optional(),
  }),
  settings: z.object({
    locale: z.string(),
    direction: z.enum(["ltr", "rtl"]),
    cslStyle: z.string(),
    templateId: z.string().optional(),
    pageGeometry: z.object({
      size: z.string(),
      margin: z.object({
        top: z.string(),
        bottom: z.string(),
        left: z.string(),
        right: z.string(),
      }),
      columns: z.union([z.literal(1), z.literal(2)]),
    }),
    numbering: z.object({
      figures: z.boolean(),
      tables: z.boolean(),
      equations: z.boolean(),
      headings: z.boolean(),
    }),
  }),
  body: z.array(blockNodeSchema),
  references: z.array(referenceSchema),
  assets: z.array(assetSchema),
  annotations: z.array(validationFindingSchema).optional(),
});

export type CanonicalDocumentSchema = z.infer<typeof canonicalDocumentSchema>;
