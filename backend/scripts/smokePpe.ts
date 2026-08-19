/**
 * Smoke test for the Publication Export Engine's Pandoc-less fallback.
 *
 * Pandoc is not installed in CI/sandbox, so this verifies that
 * `buildSubmissionPackage` degrades gracefully to pure-JS HTML rendering and
 * still emits a complete, correctly-named file set (a usable Submission.zip)
 * instead of crashing with `spawn pandoc ENOENT`.
 */
import { PublishingEngine } from "../src/publishing/engine";
import { buildSubmissionPackage } from "../src/publishing/ppe/package";
import {
  defaultCanonicalMetadata,
  defaultCanonicalSettings,
} from "../src/publishing/cdm/types";
import type { CanonicalDocument } from "../src/publishing/cdm/types";

const doc: CanonicalDocument = {
  schemaVersion: "1.0",
  metadata: defaultCanonicalMetadata({
    title: "Graceful Export Smoke Test",
    authors: [{ name: "A. Researcher" }],
  }),
  settings: defaultCanonicalSettings({ cslStyle: "apa" }),
  body: [
    { type: "heading", level: 1, content: [{ type: "text", text: "Introduction" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "We build on prior work " },
        { type: "citation", citationId: "smith2023", text: "(Smith, 2023)" },
        { type: "text", text: "." },
      ],
    },
    {
      type: "figure",
      id: "fig-1",
      alt: "Example plot",
      caption: [{ type: "paragraph", content: [{ type: "text", text: "Figure 1 caption." }] }],
    },
    {
      type: "table",
      id: "tbl-1",
      rows: [
        { isHeader: true, cells: [{ content: [{ type: "paragraph", content: [{ type: "text", text: "Col A" }] }] }, { content: [{ type: "paragraph", content: [{ type: "text", text: "Col B" }] }] }] },
        { cells: [{ content: [{ type: "paragraph", content: [{ type: "text", text: "1" }] }] }, { content: [{ type: "paragraph", content: [{ type: "text", text: "2" }] }] }] },
      ],
    },
  ],
  references: [
    {
      id: "smith2023",
      raw: "Smith, J. (2023). A study. Journal.",
      cslJson: {
        type: "article-journal",
        title: "A study",
        author: [{ family: "Smith", given: "J." }],
        issued: { "date-parts": [[2023]] },
        "container-title": "Journal",
      },
    },
  ],
  assets: [],
};

async function main() {
  const engine = new PublishingEngine();
  const built = await buildSubmissionPackage(
    doc,
    "generic",
    { placement: { figures: "separate-doc", tables: "separate-doc" }, targetFormat: "docx" },
    { engine },
  );

  const names = built.files.map((f) => f.path).sort();
  console.log("Package files:");
  for (const n of names) console.log("  -", n);

  const report = built.files.find((f) => f.path === "ExportReport.md");
  const reportText = report ? report.bytes.toString("utf8") : "";
  console.log("\nExportReport.md:\n" + reportText);

  const required = [
    "Manuscript.html",
    "Figures.html",
    "Tables.html",
    "References.bib",
    "manifest.json",
    "Metadata.json",
    "ExportReport.md",
  ];
  const missing = required.filter((r) => !names.includes(r));
  if (missing.length) {
    throw new Error("Missing expected files: " + missing.join(", "));
  }
  if (!/System Warnings/i.test(reportText) || !/Pandoc unavailable/i.test(reportText)) {
    throw new Error("Expected a Pandoc-unavailable system warning in the audit report.");
  }
  // Manuscript must actually contain the rendered citation + heading (not raw CDM).
  const manuscript = built.files.find((f) => f.path === "Manuscript.html");
  const mhtml = manuscript ? manuscript.bytes.toString("utf8") : "";
  if (!/Introduction/.test(mhtml) || !/Smith, 2023/.test(mhtml)) {
    throw new Error("Manuscript HTML missing expected content.");
  }
  console.log("\nOK: fallback package built successfully without Pandoc.");
}

main().catch((e) => {
  console.error("SMOKE TEST FAILED:", e);
  process.exit(1);
});
