/**
 * Smoke test for the consolidated export pre-check (run with `tsx`).
 *
 * Verifies:
 *  1. runExportPrecheck merges the structural ValidationEngine rules AND the
 *     citation-style pass into one report.
 *  2. A dangling citation + an APA numeric [1] + a missing "References" section
 *     all surface as blocking errors; an uncited reference is a warning.
 *  3. The job lifecycle: markNeedsReview pauses the job (claimNext skips it),
 *     and resumeJob-style override returns it to QUEUED (claimNext picks it up).
 */
import { runExportPrecheck } from "../src/audit/exportPrecheck";
import { InMemoryExportJobStore } from "../src/publishing/jobs/store";
import type { CanonicalDocument } from "../src/publishing/cdm";

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error("  ✗ " + msg);
  } else {
    console.log("  ✓ " + msg);
  }
}

async function main() {
  // ── Fixture: a document with citations, one dangling + one numeric (APA),
  //    an "Introduction" heading (no References section), and an uncited ref. ──
  const doc: CanonicalDocument = {
    schemaVersion: "1.0",
    metadata: { title: "Test Paper" },
    settings: { cslStyle: "apa" },
    body: [
      { type: "heading", level: 1, content: [{ type: "text", text: "Introduction" }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "We build on prior work " },
          { type: "citation", citationId: "cit-1", status: "resolved" },
          { type: "text", text: " and a numeric claim [1]." },
        ],
      },
    ],
    references: [{ id: "cit-2", raw: "Uncited, R. (2020). Lonely reference." }],
    assets: [],
  };

  console.log("runExportPrecheck (APA):");
  const report = runExportPrecheck(doc, { style: "APA" });

  const codes = report.findings.map((f) => f.code);
  assert(codes.includes("dangling-citation"), "detects dangling citation");
  assert(codes.includes("style-numbering"), "detects APA numeric [1] citation");
  assert(codes.includes("missing-reference-section"), "detects missing References section");
  assert(codes.includes("orphan-reference"), "detects uncited (orphan) reference");

  assert(
    report.findings.some((f) => f.source === "validation"),
    "includes validation-source findings",
  );
  assert(
    report.findings.some((f) => f.source === "citation-style"),
    "includes citation-style-source findings",
  );
  assert(report.ok === false, "ok === false when errors present");
  assert(report.errorCount >= 3, `errorCount >= 3 (got ${report.errorCount})`);
  assert(report.warningCount >= 1, `warningCount >= 1 (got ${report.warningCount})`);

  // ── Job lifecycle: pause + resume ──
  console.log("\nJob lifecycle (InMemoryExportJobStore):");
  const store = new InMemoryExportJobStore();
  const job = await store.create({
    id: "job-1",
    userId: "u-1",
    projectId: null,
    docVersionId: "dv-1",
    format: "submission",
    settings: {},
    billingEventId: "evt-1",
  });

  const needsReview = await store.markNeedsReview(job.id, report);
  assert(needsReview.status === "NEEDS_REVIEW", "markNeedsReview sets NEEDS_REVIEW");
  assert(needsReview.precheckReport !== null, "precheck report is stored");
  assert(needsReview.precheckOverride === false, "override starts false");

  const claimedWhilePaused = await store.claimNext();
  assert(claimedWhilePaused === null, "worker claimNext skips NEEDS_REVIEW job");

  await store.setPrecheck(job.id, report, true);
  await store.setStatus(job.id, "QUEUED");
  const resumed = await store.get(job.id);
  assert(resumed!.precheckOverride === true, "resume sets precheckOverride = true");

  const claimedAfter = await store.claimNext();
  assert(claimedAfter !== null, "claimNext picks up the resumed (QUEUED) job");

  console.log(`\n${failures === 0 ? "ALL PASSED" : failures + " FAILURE(S)"}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
