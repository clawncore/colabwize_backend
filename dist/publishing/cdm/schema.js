"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalDocumentSchema = exports.validationFindingSchema = exports.assetSchema = exports.referenceSchema = exports.blockNodeSchema = exports.blockUnknownSchema = exports.appendixSchema = exports.pageBreakSchema = exports.equationSchema = exports.figureSchema = exports.tableSchema = exports.tableRowSchema = exports.tableCellSchema = exports.horizontalRuleSchema = exports.codeBlockSchema = exports.blockQuoteSchema = exports.orderedListSchema = exports.bulletListSchema = exports.listItemSchema = exports.paragraphSchema = exports.headingSchema = exports.inlineNodeSchema = exports.inlineUnknownSchema = exports.hardBreakSchema = exports.mathRunSchema = exports.citationRunSchema = exports.textRunSchema = exports.inlineMarkSchema = void 0;
/**
 * Zod schema for the Canonical Document Model.
 *
 * Used by the Publishing Engine for runtime validation of a generated CDM and by
 * tests. Mirrors `types.ts`. Unknown/unsupported source nodes are carried as
 * `raw: z.unknown()` so validation never throws on third-party content.
 */
const zod_1 = require("zod");
exports.inlineMarkSchema = zod_1.z.object({
    type: zod_1.z.enum([
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
    href: zod_1.z.string().url().optional(),
    color: zod_1.z.string().optional(),
});
exports.textRunSchema = zod_1.z.object({
    type: zod_1.z.literal("text"),
    text: zod_1.z.string(),
    marks: zod_1.z.array(exports.inlineMarkSchema).optional(),
});
exports.citationRunSchema = zod_1.z.object({
    type: zod_1.z.literal("citation"),
    citationId: zod_1.z.string(),
    text: zod_1.z.string().optional(),
    url: zod_1.z.string().optional(),
    status: zod_1.z.string().optional(),
});
exports.mathRunSchema = zod_1.z.object({
    type: zod_1.z.literal("math"),
    latex: zod_1.z.string(),
    block: zod_1.z.boolean().optional(),
});
exports.hardBreakSchema = zod_1.z.object({ type: zod_1.z.literal("hardBreak") });
exports.inlineUnknownSchema = zod_1.z.object({
    type: zod_1.z.literal("inlineUnknown"),
    nodeType: zod_1.z.string(),
    raw: zod_1.z.unknown(),
});
exports.inlineNodeSchema = zod_1.z.union([
    exports.textRunSchema,
    exports.citationRunSchema,
    exports.mathRunSchema,
    exports.hardBreakSchema,
    exports.inlineUnknownSchema,
]);
exports.headingSchema = zod_1.z.object({
    type: zod_1.z.literal("heading"),
    level: zod_1.z.union([
        zod_1.z.literal(1),
        zod_1.z.literal(2),
        zod_1.z.literal(3),
        zod_1.z.literal(4),
        zod_1.z.literal(5),
        zod_1.z.literal(6),
    ]),
    content: zod_1.z.array(exports.inlineNodeSchema),
    id: zod_1.z.string().optional(),
});
exports.paragraphSchema = zod_1.z.object({
    type: zod_1.z.literal("paragraph"),
    content: zod_1.z.array(exports.inlineNodeSchema),
});
exports.listItemSchema = zod_1.z.lazy(() => zod_1.z.object({ type: zod_1.z.literal("listItem"), content: zod_1.z.array(exports.blockNodeSchema) }));
exports.bulletListSchema = zod_1.z.object({
    type: zod_1.z.literal("bulletList"),
    items: zod_1.z.array(exports.listItemSchema),
});
exports.orderedListSchema = zod_1.z.object({
    type: zod_1.z.literal("orderedList"),
    items: zod_1.z.array(exports.listItemSchema),
    start: zod_1.z.number().optional(),
});
exports.blockQuoteSchema = zod_1.z.object({
    type: zod_1.z.literal("blockquote"),
    content: zod_1.z.array(zod_1.z.lazy(() => exports.blockNodeSchema)),
});
exports.codeBlockSchema = zod_1.z.object({
    type: zod_1.z.literal("codeBlock"),
    text: zod_1.z.string(),
    language: zod_1.z.string().optional(),
    id: zod_1.z.string().optional(),
});
exports.horizontalRuleSchema = zod_1.z.object({ type: zod_1.z.literal("horizontalRule") });
exports.tableCellSchema = zod_1.z.object({
    type: zod_1.z.literal("tableCell"),
    content: zod_1.z.array(zod_1.z.lazy(() => exports.blockNodeSchema)),
    colspan: zod_1.z.number().optional(),
    rowspan: zod_1.z.number().optional(),
    isHeader: zod_1.z.boolean().optional(),
});
exports.tableRowSchema = zod_1.z.object({
    type: zod_1.z.literal("tableRow"),
    cells: zod_1.z.array(exports.tableCellSchema),
    isHeader: zod_1.z.boolean().optional(),
});
exports.tableSchema = zod_1.z.object({
    type: zod_1.z.literal("table"),
    rows: zod_1.z.array(exports.tableRowSchema),
    id: zod_1.z.string().optional(),
});
exports.figureSchema = zod_1.z.object({
    type: zod_1.z.literal("figure"),
    src: zod_1.z.string().optional(),
    alt: zod_1.z.string().optional(),
    title: zod_1.z.string().optional(),
    width: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]).optional(),
    caption: zod_1.z.array(zod_1.z.lazy(() => exports.blockNodeSchema)).optional(),
    span: zod_1.z.string().optional(),
    style: zod_1.z.string().optional(),
    assetId: zod_1.z.string().optional(),
    id: zod_1.z.string().optional(),
});
exports.equationSchema = zod_1.z.object({
    type: zod_1.z.literal("equation"),
    latex: zod_1.z.string(),
    label: zod_1.z.string().optional(),
    numbered: zod_1.z.boolean().optional(),
    id: zod_1.z.string().optional(),
});
exports.pageBreakSchema = zod_1.z.object({ type: zod_1.z.literal("pageBreak") });
exports.appendixSchema = zod_1.z.object({
    type: zod_1.z.literal("appendix"),
    title: zod_1.z.string().optional(),
    content: zod_1.z.array(zod_1.z.lazy(() => exports.blockNodeSchema)),
});
exports.blockUnknownSchema = zod_1.z.object({
    type: zod_1.z.literal("blockUnknown"),
    nodeType: zod_1.z.string(),
    raw: zod_1.z.unknown(),
});
exports.blockNodeSchema = zod_1.z.lazy(() => zod_1.z.union([
    exports.headingSchema,
    exports.paragraphSchema,
    exports.bulletListSchema,
    exports.orderedListSchema,
    exports.blockQuoteSchema,
    exports.codeBlockSchema,
    exports.horizontalRuleSchema,
    exports.tableSchema,
    exports.figureSchema,
    exports.equationSchema,
    exports.pageBreakSchema,
    exports.appendixSchema,
    exports.blockUnknownSchema,
]));
exports.referenceSchema = zod_1.z.object({
    id: zod_1.z.string(),
    cslJson: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    raw: zod_1.z.string().optional(),
    url: zod_1.z.string().optional(),
    doi: zod_1.z.string().optional(),
    refText: zod_1.z.string().optional(),
});
exports.assetSchema = zod_1.z.object({
    id: zod_1.z.string(),
    sha256: zod_1.z.string().optional(),
    mime: zod_1.z.string().optional(),
    storageKey: zod_1.z.string().optional(),
    width: zod_1.z.number().optional(),
    caption: zod_1.z.string().optional(),
});
exports.validationFindingSchema = zod_1.z.object({
    severity: zod_1.z.enum(["error", "warning", "info"]),
    code: zod_1.z.string(),
    message: zod_1.z.string(),
    locator: zod_1.z
        .object({
        blockIndex: zod_1.z.number().optional(),
        nodeType: zod_1.z.string().optional(),
        citationId: zod_1.z.string().optional(),
    })
        .optional(),
});
exports.canonicalDocumentSchema = zod_1.z.object({
    schemaVersion: zod_1.z.literal("1.0"),
    metadata: zod_1.z.object({
        title: zod_1.z.string().optional(),
        authors: zod_1.z.array(zod_1.z.object({
            name: zod_1.z.string(),
            affiliation: zod_1.z.string().optional(),
            orcid: zod_1.z.string().optional(),
        })),
        abstract: zod_1.z.string().optional(),
        keywords: zod_1.z.array(zod_1.z.string()),
        runningHead: zod_1.z.string().optional(),
        date: zod_1.z.string().optional(),
        course: zod_1.z.string().optional(),
        instructor: zod_1.z.string().optional(),
        doi: zod_1.z.string().optional(),
        license: zod_1.z.string().optional(),
    }),
    settings: zod_1.z.object({
        locale: zod_1.z.string(),
        direction: zod_1.z.enum(["ltr", "rtl"]),
        cslStyle: zod_1.z.string(),
        templateId: zod_1.z.string().optional(),
        pageGeometry: zod_1.z.object({
            size: zod_1.z.string(),
            margin: zod_1.z.object({
                top: zod_1.z.string(),
                bottom: zod_1.z.string(),
                left: zod_1.z.string(),
                right: zod_1.z.string(),
            }),
            columns: zod_1.z.union([zod_1.z.literal(1), zod_1.z.literal(2)]),
        }),
        numbering: zod_1.z.object({
            figures: zod_1.z.boolean(),
            tables: zod_1.z.boolean(),
            equations: zod_1.z.boolean(),
            headings: zod_1.z.boolean(),
        }),
    }),
    body: zod_1.z.array(exports.blockNodeSchema),
    references: zod_1.z.array(exports.referenceSchema),
    assets: zod_1.z.array(exports.assetSchema),
    annotations: zod_1.z.array(exports.validationFindingSchema).optional(),
});
