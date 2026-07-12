/**
 * Repro: drive the real ExportJobProcessor end-to-end against an in-memory
 * store + in-memory resolver with a sample CDM, to surface any runtime error
 * in the submission-generation pipeline (the "export is not working" report).
 */
import { createExportJobSystem } from "../src/publishing/jobs";
import { InMemoryExportJobStore } from "../src/publishing/jobs/store";
import { InMemoryCdmResolver } from "../src/publishing/jobs/cdmResolver";
import { JobEventBus } from "../src/publishing/jobs/queue";
import type { CanonicalDocument } from "../src/publishing/cdm";

const sampleCdm: CanonicalDocument = {
  schemaVersion: "1.0",
  metadata: { title: "Repro Paper" },
  settings: { cslStyle: "apa" },
  body: [
    { type: "heading", level: 1, content: [{ type: "text", text: "Introduction" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Prior work " },
        { type: "citation", citationId: "cit-1", status: "resolved" },
        { type: "text", text: "." },
      ],
    },
    { type: "heading", level: 1, content: [{ type: "text", text: "References" }] },
  ],
  references: [{ id: "cit-1", raw: "Author, A. (2020). A paper." }],
  assets: [],
};

async function main() {
  const system = createExportJobSystem({
    store: new InMemoryExportJobStore(),
    resolver: InMemoryCdmResolver.fromFixture("dv-1", sampleCdm),
    bus: new JobEventBus(),
    worker: undefined as never, // we run the processor directly
  });

  const enqueued = await system.service.createExportJob({
    userId: "u-1",
    projectId: null,
    docVersionId: "dv-1",
    format: "submission",
    settings: { ppe: { mode: "publication", profileId: "generic" } },
  });
  console.log("enqueued.status =", enqueued.status, "jobId =", enqueued.jobId);

  const completed = await system.processor.process(enqueued.jobId);
  console.log("process.status =", completed.status);
  console.log("artifactUrl =", completed.artifactUrl);
  console.log("error =", completed.error);
  console.log("precheck ok =", completed.precheckReport?.ok, "errors =", completed.precheckReport?.errorCount);
  if (completed.error) {
    console.error("EXPORT FAILED:", completed.error);
    process.exit(1);
  }
  console.log("EXPORT OK");
  process.exit(0);
}

main().catch((e) => {
  console.error("THREW:", e);
  process.exit(1);
});
