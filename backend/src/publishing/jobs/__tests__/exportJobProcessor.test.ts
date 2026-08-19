import { Readable } from "stream";
import { ExportJobProcessor, type PublishingEngineLike } from "../processor";
import {
  InMemoryExportJobStore,
  type ExportJobStore,
} from "../store";
import { InMemoryArtifactStore } from "../artifactStore";
import { InMemoryCdmResolver } from "../cdmResolver";
import { JobEventBus } from "../queue";
import { makeSampleCdm } from "../../test-utils/fixtures";
import type { GenResult, CanonicalDocument } from "../../types";
import type { ExportJobSettings } from "../types";
import {
  LocalDestinationAdapter,
  CloudStorageDestinationAdapter,
  InMemoryDestinationRegistry,
  type CloudUploader,
  type DestinationRegistry,
} from "../../destinations";

function fakeUploader() {
  const uploads: Array<{ userId: string; fileName: string; bytes: number }> = [];
  const uploader: CloudUploader = {
    async uploadFile(userId, fileName, stream) {
      const chunks: Buffer[] = [];
      for await (const c of stream as Readable) chunks.push(c as Buffer);
      uploads.push({ userId, fileName, bytes: Buffer.concat(chunks).length });
      return { id: "remote-1", webUrl: `https://cloud/${fileName}` };
    },
  };
  return { uploader, uploads };
}

const DOC_VERSION = "dv-1";
const BILLING_EVENT = "evt-1";

function fakeEngine(
  generate: (doc: CanonicalDocument) => Promise<GenResult> = async () => ({
    format: "pdf",
    buffer: Buffer.from("artifact-bytes"),
    mimeType: "application/pdf",
    sizeBytes: 14,
    checksum: "c0ffee",
  }),
): PublishingEngineLike {
  return { generate };
}

interface BillingCalls {
  confirm: string[];
  release: { id: string; reason?: string }[];
}
function fakeBilling(calls: BillingCalls) {
  return {
    confirm: async (id: string) => {
      calls.confirm.push(id);
    },
    release: async (id: string, reason?: string) => {
      calls.release.push({ id, reason });
    },
  };
}

async function seedJob(
  store: ExportJobStore,
  overrides: Partial<{ format: string; maxAttempts: number; settings?: ExportJobSettings }> = {},
): Promise<string> {
  const job = await store.create({
    id: "job-1",
    userId: "user-1",
    projectId: null,
    docVersionId: DOC_VERSION,
    format: overrides.format ?? "pdf",
    settings: overrides.settings ?? ({} as ExportJobSettings),
    billingEventId: BILLING_EVENT,
  });
  if (overrides.maxAttempts !== undefined) job.maxAttempts = overrides.maxAttempts;
  return job.id;
}

describe("ExportJobProcessor", () => {
  it("resolves CDM, generates, stores artifact, confirms billing on success", async () => {
    const store = new InMemoryExportJobStore();
    const artifactStore = new InMemoryArtifactStore();
    const bus = new JobEventBus();
    const calls = { confirm: [] as string[], release: [] as { id: string; reason?: string }[] };
    const billing = fakeBilling(calls);
    const events: string[] = [];
    bus.subscribe("job-1", (e) => events.push(e.status));

    const processor = new ExportJobProcessor({
      store,
      artifactStore,
      resolver: InMemoryCdmResolver.fromFixture(DOC_VERSION, makeSampleCdm()),
      engine: fakeEngine(),
      bus,
      confirmBilling: billing.confirm,
      releaseBilling: billing.release,
    });

    const jobId = await seedJob(store);
    const result = await processor.process(jobId);

    expect(result.status).toBe("SUCCEEDED");
    expect(result.artifactUrl).toBe("memory://user-1/exports/job-1/document.pdf");
    expect(result.artifactChecksum).toBe("c0ffee");
    // Billing charged exactly once; never refunded.
    expect(calls.confirm).toEqual([BILLING_EVENT]);
    expect(calls.release).toEqual([]);
    expect(events).toContain("SUCCEEDED");
  });

  it("retries on transient failure, then confirms only once", async () => {
    const store = new InMemoryExportJobStore();
    const calls = { confirm: [] as string[], release: [] as { id: string; reason?: string }[] };
    const billing = fakeBilling(calls);
    let attempts = 0;
    const engine = fakeEngine(async () => {
      attempts += 1;
      if (attempts < 2) throw new Error("pandoc crashed");
      return {
        format: "pdf",
        buffer: Buffer.from("ok"),
        mimeType: "application/pdf",
        sizeBytes: 2,
        checksum: "ok",
      };
    });

    const processor = new ExportJobProcessor({
      store,
      artifactStore: new InMemoryArtifactStore(),
      resolver: InMemoryCdmResolver.fromFixture(DOC_VERSION, makeSampleCdm()),
      engine,
      bus: new JobEventBus(),
      confirmBilling: billing.confirm,
      releaseBilling: billing.release,
    });

    const jobId = await seedJob(store);
    const first = await processor.process(jobId);
    expect(first.status).toBe("RETRYING");
    expect(calls.release).toEqual([]); // hold kept across retry

    const second = await processor.process(jobId);
    expect(second.status).toBe("SUCCEEDED");
    expect(calls.confirm).toEqual([BILLING_EVENT]);
    expect(calls.release).toEqual([]);
    expect(attempts).toBe(2);
  });

  it("releases billing when retries are exhausted", async () => {
    const store = new InMemoryExportJobStore();
    const calls = { confirm: [] as string[], release: [] as { id: string; reason?: string }[] };
    const billing = fakeBilling(calls);
    const engine = fakeEngine(async () => {
      throw new Error("permanent failure");
    });

    const processor = new ExportJobProcessor({
      store,
      artifactStore: new InMemoryArtifactStore(),
      resolver: InMemoryCdmResolver.fromFixture(DOC_VERSION, makeSampleCdm()),
      engine,
      bus: new JobEventBus(),
      confirmBilling: billing.confirm,
      releaseBilling: billing.release,
    });

    const jobId = await seedJob(store, { maxAttempts: 1 });
    const result = await processor.process(jobId);
    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("permanent failure");
    expect(calls.confirm).toEqual([]);
    expect(calls.release).toEqual([{ id: BILLING_EVENT, reason: "permanent failure" }]);
  });

  it("abandons a CANCELLED job without work or billing changes", async () => {
    const store = new InMemoryExportJobStore();
    const calls = { confirm: [] as string[], release: [] as { id: string; reason?: string }[] };
    const billing = fakeBilling(calls);
    const engine = fakeEngine();
    const processor = new ExportJobProcessor({
      store,
      artifactStore: new InMemoryArtifactStore(),
      resolver: InMemoryCdmResolver.fromFixture(DOC_VERSION, makeSampleCdm()),
      engine,
      bus: new JobEventBus(),
      confirmBilling: billing.confirm,
      releaseBilling: billing.release,
    });

    const jobId = await seedJob(store);
    await store.setStatus(jobId, "CANCELLED");
    const result = await processor.process(jobId);
    expect(result.status).toBe("CANCELLED");
    expect(calls.confirm).toEqual([]);
    expect(calls.release).toEqual([]);
  });

  it("pushes to a cloud destination after success (Phase 5)", async () => {
    const store = new InMemoryExportJobStore();
    const calls = { confirm: [] as string[], release: [] as { id: string; reason?: string }[] };
    const { uploader, uploads } = fakeUploader();
    const registry: DestinationRegistry = new InMemoryDestinationRegistry([
      new LocalDestinationAdapter(),
      new CloudStorageDestinationAdapter("google-drive", uploader),
    ]);

    const processor = new ExportJobProcessor({
      store,
      artifactStore: new InMemoryArtifactStore(),
      resolver: InMemoryCdmResolver.fromFixture(DOC_VERSION, makeSampleCdm()),
      engine: fakeEngine(),
      bus: new JobEventBus(),
      confirmBilling: (id) => { calls.confirm.push(id); return Promise.resolve(); },
      releaseBilling: (id, reason) => { calls.release.push({ id, reason }); return Promise.resolve(); },
      destinationRegistry: registry,
    });

    const jobId = await seedJob(store, { settings: { destination: "google-drive" } });
    const result = await processor.process(jobId);
    expect(result.status).toBe("SUCCEEDED");
    // Billing still confirmed exactly once; export not blocked by delivery.
    expect(calls.confirm).toEqual([BILLING_EVENT]);
    expect(uploads).toEqual([
      { userId: "user-1", fileName: "document.pdf", bytes: 14 },
    ]);
  });

  it("skips push for an unknown destination but still succeeds", async () => {
    const store = new InMemoryExportJobStore();
    const calls = { confirm: [] as string[], release: [] as { id: string; reason?: string }[] };
    const { uploader, uploads } = fakeUploader();
    const registry: DestinationRegistry = new InMemoryDestinationRegistry([
      new LocalDestinationAdapter(),
      new CloudStorageDestinationAdapter("google-drive", uploader),
    ]);

    const processor = new ExportJobProcessor({
      store,
      artifactStore: new InMemoryArtifactStore(),
      resolver: InMemoryCdmResolver.fromFixture(DOC_VERSION, makeSampleCdm()),
      engine: fakeEngine(),
      bus: new JobEventBus(),
      confirmBilling: (id) => { calls.confirm.push(id); return Promise.resolve(); },
      releaseBilling: (id, reason) => { calls.release.push({ id, reason }); return Promise.resolve(); },
      destinationRegistry: registry,
    });

    const jobId = await seedJob(store, { settings: { destination: "dropbox" } });
    const result = await processor.process(jobId);
    expect(result.status).toBe("SUCCEEDED");
    expect(uploads).toEqual([]); // no adapter for dropbox -> no push
  });
});
