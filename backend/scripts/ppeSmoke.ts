/**
 * Publication Export Engine — logic smoke test (run with tsx).
 *
 * Exercises the pure PPE modules end-to-end against a small fixture CDM:
 *   - assignStableIds (deterministic FIG-/TAB-/EQ- ids)
 *   - buildCrossReferenceIndex (display numbers + citation integrity)
 *   - buildPlaceholderLabels (<<FIGURE_001>> tokens)
 *   - buildSubmissionPackage + SubmissionPackageAdapter (zip contents)
 *
 * Run: npx tsx scripts/ppeSmoke.ts   (from backend/)
 */
import AdmZip from "adm-zip";
import {
  defaultCanonicalMetadata,
  defaultCanonicalSettings,
  type CanonicalDocument,
} from "../src/publishing/cdm/types";
import { assignStableIds } from "../src/publishing/ppe/ids";
import { buildCrossReferenceIndex } from "../src/publishing/ppe/xref";
import {
  buildPlaceholderLabels,
  defaultPlaceholderFormatter,
} from "../src/publishing/ppe/serializers/placeholder";
import {
  buildSubmissionPackage,
  type PackageBuildDeps,
} from "../src/publishing/ppe/package";
import { SubmissionPackageAdapter } from "../src/publishing/ppe/adapter";
import { publishingEngine } from "../src/publishing/engine";

const PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function makeDoc(): CanonicalDocument {
  return {
    schemaVersion: "1.0",
    metadata: {
      ...defaultCanonicalMetadata({ title: "Smoke Test Paper" }),
      authors: [{ name: "Jane Doe" }],
      date: "2026-01-01",
    },
    settings: defaultCanonicalSettings(),
    body: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "We present Figure 1 and cite (Smith2020)." }],
      },
      {
        type: "figure",
        src: PNG_DATA_URI,
        caption: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "A sample figure." }],
          },
        ],
      },
      {
        type: "table",
        rows: [
          {
            type: "tableRow",
            cells: [
              {
                type: "tableCell",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "x" }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "paragraph",
        content: [{ type: "citation", citationId: "Smith2020" }],
      },
    ],
    references: [
      {
        id: "Smith2020",
        doi: "10.1000/xyz",
        cslJson: {
          type: "article",
          title: "On Things",
          author: [{ family: "Smith", given: "J." }],
          issued: { "date-parts": [[2020]] },
          DOI: "10.1000/xyz",
        },
      },
    ],
    assets: [],
  };
}

let failures = 0;
function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  ok  - ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL- ${label}`);
  }
}

async function main(): Promise<void> {
  const doc = makeDoc();

  // 1. Stable ids
  const { doc: augmented, ids } = assignStableIds(doc);
  assert(ids.figures[0] === "FIG-2026-0001", "figure id is FIG-2026-0001 (sequential, year 2026)");
  assert(ids.tables[0] === "TAB-2026-0001", "table id is TAB-2026-0001");
  assert(augmented.body[1].type === "figure" && (augmented.body[1] as any).id === "FIG-2026-0001", "figure node carries stamped id");

  // 2. Cross-reference index
  const { index, findings } = buildCrossReferenceIndex(augmented);
  assert(index.figures[0].displayNumber === "Figure 1", "figure display number is 'Figure 1'");
  assert(index.figures[0].referenced === true, "figure 1 is referenced in prose");
  assert(index.tables[0].referenced === false, "table 1 is unreferenced (warning expected)");
  assert(index.citations[0].resolved === true, "citation Smith2020 resolves to a reference");
  assert(
    findings.filter((f) => f.code === "BROKEN_CITATION").length === 0,
    "no BROKEN_CITATION findings",
  );
  assert(
    findings.filter((f) => f.severity === "error").length === 0,
    "no error-severity findings on a well-formed doc",
  );
  assert(
    findings.some((f) => f.code === "OBJECT_UNREFERENCED"),
    "unreferenced table produces OBJECT_UNREFERENCED warning",
  );

  // 3. Placeholder labels
  const labels = buildPlaceholderLabels(index, defaultPlaceholderFormatter);
  assert(
    labels[index.figures[0].internalId] === "<<FIGURE_001>>",
    "default placeholder token is <<FIGURE_001>>",
  );

  // 4. Package build (fake engine) — also exercises asset extraction (data URI)
  const fakeEngine: PackageBuildDeps["engine"] = {
    async generate(_d, _opts) {
      return {
        format: "docx",
        buffer: Buffer.from("fake-docx-bytes"),
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: 16,
        checksum: "x",
      };
    },
  };
  const built = await buildSubmissionPackage(
    doc,
    "nature",
    { mode: "publication", profileId: "nature" },
    { engine: fakeEngine },
  );
  const paths = built.files.map((f) => f.path).sort();
  for (const expected of [
    "Manuscript.docx",
    "Figures.docx",
    "Tables.docx",
    "References.bib",
    "Metadata.json",
    "manifest.json",
    "CoverLetter.docx",
    "ExportReport.md",
  ]) {
    assert(paths.includes(expected), `package contains ${expected}`);
  }
  const imageFiles = built.files.filter((f) => f.path.startsWith("Images/"));
  assert(imageFiles.length === 1, "extracted image written to Images/ folder");
  assert(built.manifest.profileId === "nature", "manifest records profileId nature");
  assert(built.audit.summary.figures === 1, "audit summary counts 1 figure");

  // 5. Adapter zips the package into Submission.zip
  const adapter = new SubmissionPackageAdapter(fakeEngine);
  const result = await adapter.generate(augmented, {
    format: "submission",
    ppe: { mode: "publication", profileId: "nature" },
  });
  assert(result.format === "submission", "adapter returns format 'submission'");
  assert(result.mimeType === "application/zip", "adapter mime is application/zip");
  const zip = new AdmZip(result.buffer);
  const entryNames = zip.getEntries().map((e) => e.entryName).sort();
  assert(
    entryNames.includes("Manuscript.docx") && entryNames.includes("manifest.json"),
    "zip contains Manuscript.docx and manifest.json",
  );

  // 6. Real engine wiring sanity (does not run a worker; just constructs)
  assert(typeof publishingEngine.generate === "function", "publishingEngine present");

  console.log("");
  if (failures === 0) {
    console.log("ALL PPE SMOKE TESTS PASSED");
  } else {
    console.error(`${failures} PPE SMOKE TEST(S) FAILED`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("PPE smoke test crashed:", e);
  process.exit(1);
});
