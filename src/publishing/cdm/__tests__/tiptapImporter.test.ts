import { tiptapToCdm, cdmToTiptap } from "../index";
import { canonicalDocumentSchema } from "../schema";
import { CanonicalDocument } from "../types";
import { TiptapDoc } from "../tiptap";

const sampleDoc: TiptapDoc = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Sample Academic Paper" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "We argue ", marks: [{ type: "bold" }] },
        {
          type: "citation",
          attrs: { citationId: "smith2023", text: "(Smith, 2023)", status: "resolved" },
        },
        { type: "text", text: " that " },
        { type: "math", attrs: { latex: "E = mc^2" } },
        { type: "text", text: " holds." },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        {
          type: "citation",
          attrs: { citationId: "orphan2024", text: "(Orphan, 2024)", status: "unresolved" },
        },
        { type: "text", text: " for an unverified claim." },
      ],
    },
    {
      type: "bulletList",
      content: [
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First point" }] }] },
        { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Second point" }] }] },
      ],
    },
    {
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A quoted insight." }] }],
    },
    {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [{ type: "text", text: "const x = 1;" }],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Col A" }] }] },
            { type: "tableHeader", content: [{ type: "paragraph", content: [{ type: "text", text: "Col B" }] }] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }] },
            { type: "tableCell", content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }] },
          ],
        },
      ],
    },
    {
      type: "figure",
      attrs: { span: "full" },
      content: [
        { type: "imageExtension", attrs: { src: "https://example.com/fig1.png", alt: "Fig 1", width: 400 } },
        { type: "figcaption", content: [{ type: "paragraph", content: [{ type: "text", text: "Caption text." }] }] },
      ],
    },
    {
      type: "bibliographyEntry",
      attrs: { citationId: "smith2023", doi: "10.1/abc", url: "https://doi.org/10.1/abc" },
      content: [{ type: "text", text: "Smith, J. (2023). A Study. Journal." }],
    },
    {
      type: "bibliographyEntry",
      attrs: { citationId: "jones2022" },
      content: [{ type: "text", text: "Jones, K. (2022). Another Study." }],
    },
    {
      type: "fooBar",
      attrs: { xyz: true },
      content: [{ type: "text", text: "unknown" }],
    },
  ],
};

describe("tiptapToCdm", () => {
  const cdm = tiptapToCdm(sampleDoc);

  it("preserves semantic block structure (bibliography excluded from body)", () => {
    expect(cdm.body.filter((b) => b.type === "heading").length).toBe(1);
    expect(cdm.body[0]).toMatchObject({ type: "heading", level: 1 });
    expect(
      cdm.body.some(
        (b) => b.type === "blockUnknown" && b.nodeType === "fooBar",
      ),
    ).toBe(true);
  });

  it("converts inline marks, citations and math", () => {
    const para = cdm.body[1];
    if (para.type !== "paragraph") throw new Error("expected paragraph");
    expect(para.content[0]).toMatchObject({ type: "text", marks: [{ type: "bold" }] });
    expect(para.content[1]).toMatchObject({ type: "citation", citationId: "smith2023" });
    expect(para.content[3]).toMatchObject({ type: "math", latex: "E = mc^2" });
  });

  it("converts lists", () => {
    const list = cdm.body[3];
    if (list.type !== "bulletList") throw new Error("expected bulletList");
    expect(list.items).toHaveLength(2);
  });

  it("converts tables with header detection", () => {
    const table = cdm.body[6];
    if (table.type !== "table") throw new Error("expected table");
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].isHeader).toBe(true);
    expect(table.rows[0].cells[0].isHeader).toBe(true);
    expect(table.rows[1].cells[0].isHeader).toBe(false);
  });

  it("converts figures with image + caption", () => {
    const fig = cdm.body[7];
    if (fig.type !== "figure") throw new Error("expected figure");
    expect(fig.src).toBe("https://example.com/fig1.png");
    expect(fig.assetId).toBeDefined();
    expect(fig.caption).toBeDefined();
  });

  it("lifts bibliography entries into references (not body)", () => {
    expect(cdm.references).toHaveLength(2);
    expect(cdm.references.map((r) => r.id).sort()).toEqual(["jones2022", "smith2023"]);
    expect(cdm.references[0].doi).toBe("10.1/abc");
  });

  it("records findings for unsupported nodes and unresolved citations", () => {
    expect(cdm.annotations).toBeDefined();
    const codes = (cdm.annotations ?? []).map((f) => f.code);
    expect(codes).toContain("unsupported_block_node");
    expect(codes).toContain("unresolved_citation");
  });

  it("produces a schema-valid CanonicalDocument", () => {
    expect(() => canonicalDocumentSchema.parse(cdm)).not.toThrow();
    expect(cdm.schemaVersion).toBe("1.0");
  });
});

describe("cdmToTiptap (round-trip)", () => {
  it("re-materializes bibliography entries and core nodes", () => {
    const cdm = tiptapToCdm(sampleDoc);
    const doc = cdmToTiptap(cdm);
    expect(doc.type).toBe("doc");
    const types = doc.content.map((n) => n.type);
    expect(types).toContain("heading");
    expect(types).toContain("table");
    expect(types).toContain("figure");
    // references re-materialized as bibliographyEntry
    const bib = doc.content.filter((n) => n.type === "bibliographyEntry");
    expect(bib).toHaveLength(2);
    // citations preserved (nested inside paragraphs)
    const countCitations = (nodes: { type: string; content?: unknown[] }[]): number =>
      nodes.reduce((acc, n) => {
        let c = acc + (n.type === "citation" ? 1 : 0);
        if (Array.isArray(n.content)) {
          c += countCitations(n.content as { type: string; content?: unknown[] }[]);
        }
        return c;
      }, 0);
    expect(countCitations(doc.content as { type: string; content?: unknown[] }[])).toBeGreaterThanOrEqual(2);
  });
});

describe("tiptapToCdm error handling", () => {
  it("throws on non-TipTap input", () => {
    expect(() => tiptapToCdm({ type: "notdoc", content: [] })).toThrow();
  });
});
