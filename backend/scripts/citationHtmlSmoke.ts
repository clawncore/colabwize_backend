/**
 * Smoke test for the Citation Hyperlink & Metadata Preservation Engine.
 *
 * Builds a small CDM with two references (one DOI, one bare URL inside `raw`)
 * and two in-text citations, renders it with `cdmToHtml`, and asserts the
 * output carries: stable `#ref-<id>` anchors, clickable in-text citations,
 * clickable DOI/URL links, a "↩ Back" link, document metadata, and no bare
 * `doi:10.` tokens. Then optionally converts to DOCX via Pandoc and checks the
 * links survive the conversion. Run with: `tsx backend/scripts/citationHtmlSmoke.ts`
 */
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cdmToHtml } from "../src/publishing/serializers/html";
import {
  buildCitationMetadata,
  normalizeDoi,
  validateCitationLinks,
} from "../src/publishing/citations/htmlCitation";
import { defaultCanonicalSettings } from "../src/publishing/cdm";
import type { CanonicalDocument } from "../src/publishing/cdm";

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    console.error(`  ✗ ${name}`);
    failures += 1;
  }
}

function buildDoc(unresolved = false): CanonicalDocument {
  const refId = unresolved ? "missing-ref" : "ref2";
  return {
    schemaVersion: "1.0",
    metadata: {
      title: "Test Manuscript",
      authors: [{ name: "Jane Roe", affiliation: "ColabWize University" }],
      abstract: "An abstract for the smoke test.",
      keywords: ["citations", "integrity"],
      date: "2026-07-11",
    },
    settings: defaultCanonicalSettings({ cslStyle: "ieee" }),
    body: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Recent work " },
          { type: "citation", citationId: "ref1", text: "[1]" },
          { type: "text", text: " shows promise; see also " },
          { type: "citation", citationId: refId, text: "[2]" },
          { type: "text", text: "." },
        ],
      },
    ],
    references: [
      {
        id: "ref1",
        // DOI present but NOT in raw → engine must append a clickable DOI link.
        doi: "10.1000/xyz123",
        raw: "Smith, J. (2020). Title of paper. Journal, 12(3), 45-67.",
        cslJson: {
          type: "article-journal",
          title: "Title of paper",
          author: [{ family: "Smith", given: "J." }],
          issued: { "date-parts": [[2020]] },
        },
      },
      {
        id: "ref2",
        // Bare URL inside raw → must become a clickable <a class="ext-link">.
        url: "https://example.org/another",
        raw: "Doe, A. (2021). Another paper. https://example.org/another",
      },
    ],
    assets: [],
  };
}

console.log("Citation HTML engine — smoke test");
const doc = buildDoc();
const html = cdmToHtml(doc);

console.log("\nIn-text citations:");
check('in-text link to #ref-ref1', html.includes('href="#ref-ref1"'));
check('in-text link to #ref-ref2', html.includes('href="#ref-ref2"'));
check('first occurrence carries id="cite-ref1"', html.includes('id="cite-ref1"'));
check('data-citation-id on in-text', html.includes('data-citation-id="ref1"'));
check('no duplicate id="cite-ref1"', (html.match(/id="cite-ref1"/g) || []).length === 1);

console.log("\nBibliography:");
check('anchor id="ref-ref1"', html.includes('id="ref-ref1"'));
check('anchor id="ref-ref2"', html.includes('id="ref-ref2"'));
check('data-citation-id on entry', html.includes('data-citation-id="ref2"'));
check('back-link ↩ present', html.includes("↩ Back"));
check('back-link targets #cite-ref1', html.includes('href="#cite-ref1"'));

console.log("\nClickable DOIs / URLs:");
check('DOI rendered as https link', html.includes("https://doi.org/10.1000/xyz123"));
check('DOI link uses doi-link class', html.includes('class="doi-link"'));
check('raw URL uses ext-link class', html.includes('class="ext-link"'));
check('no bare "doi:10." token', !/doi:10\./.test(html));
check('no "#bib-" legacy anchors remain', !html.includes('href="#bib-'));

console.log("\nDocument metadata (standalone HTML):");
// Meta tags only emit in full-document mode (standalone HTML / PDF preview).
const full = cdmToHtml(doc, { fullDocument: true });
check('author meta tag', full.includes('<meta name="author"'));
check('keywords meta tag', full.includes('<meta name="keywords"'));
check('abstract meta tag', full.includes('<meta name="description"'));

console.log("\nDocument metadata (Pandoc -M flags):");
const meta = buildCitationMetadata(doc);
check("metadata has title", meta.title === "Test Manuscript");
check("metadata has author", (meta.author ?? "").includes("Jane Roe"));
check("metadata has keywords", (meta.keywords ?? "").includes("citations"));
check("metadata has abstract", (meta.abstract ?? "").includes("abstract"));

console.log("\nValidation (validateCitationLinks):");
const ok = validateCitationLinks(doc);
check("resolved doc passes (ok=true)", ok.ok === true);
check("resolved doc has no errors", !ok.findings.some((f) => f.severity === "error"));
const bad = validateCitationLinks(buildDoc(true));
check("unresolved citation fails (ok=false)", bad.ok === false);
check(
  "unresolved citation reports unresolved-citation",
  bad.findings.some((f) => f.code === "unresolved-citation"),
);

console.log("\nnormalizeDoi:");
check("doi:10.x → https", normalizeDoi("doi:10.1234/abc") === "https://doi.org/10.1234/abc");
check("bare 10.x → https", normalizeDoi("10.1234/abc") === "https://doi.org/10.1234/abc");
check("already url → unchanged (trimmed)", normalizeDoi("https://doi.org/10.1/2.") === "https://doi.org/10.1/2");

console.log("\nOptional: Pandoc HTML→DOCX link survival:");
try {
  const dir = mkdtempSync(join(tmpdir(), "cw-cite-"));
  const docxPath = join(dir, "out.docx");
  execSync(`pandoc -f html -t docx -o "${docxPath}"`, { input: html });
  // DOCX is a zip; the document XML should still carry the DOI URL + the
  // internal anchor (as a Word bookmark/hyperlink target).
  const xml = execSync(`unzip -p "${docxPath}" word/document.xml`, {
    encoding: "utf-8",
  });
  check("DOCX keeps doi.org URL", xml.includes("doi.org/10.1000/xyz123"));
  check("DOCX keeps internal ref-ref1 anchor", xml.includes("ref-ref1"));
  check("DOCX keeps ↩ Back link", xml.includes("↩ Back"));
} catch (e) {
  console.log("  (skipped — pandoc/unzip unavailable or failed)");
  console.log(`   ${(e as Error).message.split("\n")[0]}`);
}

console.log("");
if (failures > 0) {
  console.error(`FAILED: ${failures} assertion(s)`);
  process.exit(1);
}
console.log("PASSED");
