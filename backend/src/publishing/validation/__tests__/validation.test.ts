import { ValidationEngine, createValidationEngine } from "../engine";
import { DEFAULT_VALIDATION_RULES } from "../rules";
import { tiptapToCdm } from "../../cdm";
import type { CanonicalDocument, Reference, Asset } from "../../cdm";

function doc(partial: Partial<CanonicalDocument> = {}): CanonicalDocument {
  return {
    schemaVersion: "1.0",
    metadata: { title: "T", authors: [] },
    settings: {
      locale: "en-US",
      direction: "ltr",
      cslStyle: "apa",
      pageGeometry: { size: "A4", margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" }, columns: 1 },
      numbering: { figures: true, tables: true, equations: true, headings: true },
    },
    body: [],
    references: [] as Reference[],
    assets: [] as Asset[],
    ...partial,
  };
}

describe("ValidationEngine", () => {
  const engine = createValidationEngine();

  it("flags an empty document as an error", () => {
    const report = engine.validate(doc({ body: [] }));
    expect(report.ok).toBe(false);
    expect(report.findings.map((f) => f.code)).toContain("empty-document");
  });

  it("flags a dangling citation (id not in references)", () => {
    const d = doc({
      body: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            { type: "citation", citationId: "missing", text: "(?)", status: "resolved" },
          ],
        },
      ],
      references: [{ id: "smith2023", raw: "Smith." }],
    });
    const report = engine.validate(d);
    expect(report.errorCount).toBeGreaterThanOrEqual(1);
    expect(report.findings.map((f) => f.code)).toContain("dangling-citation");
  });

  it("flags an unresolved citation", () => {
    const d = doc({
      body: [
        {
          type: "paragraph",
          content: [{ type: "citation", citationId: "smith2023", text: "(?)", status: "unresolved" }],
        },
      ],
      references: [{ id: "smith2023", raw: "Smith." }],
    });
    const report = engine.validate(d);
    expect(report.findings.map((f) => f.code)).toContain("unresolved-citation");
  });

  it("warns on an orphan reference (never cited)", () => {
    const d = doc({
      body: [{ type: "paragraph", content: [{ type: "text", text: "No citations here." }] }],
      references: [{ id: "orphan", raw: "Orphan ref." }],
    });
    const report = engine.validate(d);
    expect(report.warningCount).toBeGreaterThanOrEqual(1);
    expect(report.findings.map((f) => f.code)).toContain("orphan-reference");
    // An orphan reference is a warning, not a blocking error.
    expect(report.ok).toBe(true);
  });

  it("warns on empty sections (heading with no body)", () => {
    const d = doc({
      body: [
        { type: "heading", level: 1, content: [{ type: "text", text: "A" }] },
        { type: "heading", level: 1, content: [{ type: "text", text: "B" }] },
      ],
    });
    const report = engine.validate(d);
    expect(report.findings.map((f) => f.code)).toContain("empty-section");
  });

  it("warns on orphan and missing assets", () => {
    const d = doc({
      body: [
        { type: "paragraph", content: [{ type: "text", text: "Body." }] },
        { type: "figure", assetId: "gone", caption: { type: "paragraph", content: [] } },
      ],
      assets: [{ id: "unused" }],
    });
    const report = engine.validate(d);
    const codes = report.findings.map((f) => f.code);
    expect(codes).toContain("orphan-asset");
    expect(codes).toContain("missing-asset");
  });

  it("warns when the title is missing", () => {
    const d = doc({
      body: [{ type: "paragraph", content: [{ type: "text", text: "Body." }] }],
      metadata: { authors: [] },
    });
    const report = engine.validate(d);
    expect(report.findings.map((f) => f.code)).toContain("missing-title");
  });

  it("passes a clean, fully-cited document", () => {
    const d = doc({
      body: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            { type: "citation", citationId: "smith2023", text: "(Smith, 2023)", status: "resolved" },
            { type: "text", text: "." },
          ],
        },
      ],
      references: [{ id: "smith2023", raw: "Smith, J. (2023)." }],
      assets: [{ id: "fig1" }],
    });
    const report = engine.validate(d);
    expect(report.errorCount).toBe(0);
    expect(report.ok).toBe(true);
  });

  it("allows custom rule subsets via injection", () => {
    const onlyEmpty = new ValidationEngine(
      DEFAULT_VALIDATION_RULES.filter((r) => r.code === "empty-document"),
    );
    const d = doc({
      body: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
      references: [{ id: "z", raw: "z" }], // would warn under full set
    });
    const report = onlyEmpty.validate(d);
    expect(report.findings.map((f) => f.code)).not.toContain("orphan-reference");
    expect(report.errorCount).toBe(0);
  });

  it("validates live TipTap content imported to CDM (router /content path)", () => {
    // Mirrors the `POST /api/publishing/validate` handler when raw editor
    // `content` is supplied: tiptapToCdm -> ValidationEngine.validate.
    const tiptapDoc = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "My Title" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "See " },
            { type: "citation", attrs: { citationId: "missing" }, status: "resolved" },
          ],
        },
        { type: "bibliographyEntry", attrs: { citationId: "smith2023" } },
      ],
    };
    const cd: CanonicalDocument = tiptapToCdm(tiptapDoc);
    const report = engine.validate(cd);
    // The cited "missing" id is not in the imported references -> dangling.
    expect(report.findings.map((f) => f.code)).toContain("dangling-citation");
    expect(report.errorCount).toBeGreaterThanOrEqual(1);
  });
});
