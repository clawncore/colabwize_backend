import { createExportJobSystem } from "../index";
import type { ExportEngineLike } from "../service";
import { InMemoryExportJobStore } from "../store";
import { InMemoryArtifactStore } from "../artifactStore";
import { InMemoryCdmResolver } from "../cdmResolver";
import { JobEventBus } from "../queue";
import { makeSampleCdm } from "../../test-utils/fixtures";
import type { GenResult } from "../../types";
import type { ExportJobSettings } from "../types";
import type { BillingClient } from "../service";

const DOC_VERSION = "dv-1";

function defaultGenerate(): Promise<GenResult> {
  return Promise.resolve({
    format: "pdf",
    buffer: Buffer.from("bytes"),
    mimeType: "application/pdf",
    sizeBytes: 5,
    checksum: "abc123",
  });
}

function makeEngine(complexity: "fast" | "slow"): ExportEngineLike {
  return {
    generate: defaultGenerate,
    getAdapter: () => ({ estimateComplexity: () => complexity }),
  };
}

interface BillingLog {
  holds: { userId: string; referenceId: string; words: number }[];
  confirms: string[];
  releases: { id: string; reason?: string }[];
}

function makeBilling(log: BillingLog): BillingClient {
  return {
    hold: async (userId, referenceId, wordCount) => {
      log.holds.push({ userId, referenceId, words: wordCount });
      return { eventId: `evt-${referenceId}` };
    },
    confirm: async (id) => {
      log.confirms.push(id);
    },
    release: async (id, reason) => {
      log.releases.push({ id, reason });
    },
  };
}

describe("ExportJobService (adaptive execution + billing)", () => {
  function build(complexity: "fast" | "slow") {
    const store = new InMemoryExportJobStore();
    const artifactStore = new InMemoryArtifactStore();
    const resolver = InMemoryCdmResolver.fromFixture(DOC_VERSION, makeSampleCdm());
    const engine = makeEngine(complexity);
    const bus = new JobEventBus();
    const billingLog: BillingLog = { holds: [], confirms: [], releases: [] };
    const billing = makeBilling(billingLog);
    const system = createExportJobSystem({
      store,
      artifactStore,
      resolver,
      engine,
      bus,
      billing,
    });
    return { system, store, billingLog };
  }

  const input = {
    userId: "user-1",
    docVersionId: DOC_VERSION,
    format: "pdf" as const,
    settings: {} as ExportJobSettings,
  };

  it("acquires a billing hold at enqueue time", async () => {
    const { system, billingLog } = build("slow");
    await system.service.createExportJob(input);
    expect(billingLog.holds).toHaveLength(1);
    expect(billingLog.holds[0].userId).toBe("user-1");
    // Not yet confirmed (async job not run).
    expect(billingLog.confirms).toEqual([]);
  });

  it("runs fast formats synchronously and returns the artifact", async () => {
    const { system, billingLog } = build("fast");
    const enqueued = await system.service.createExportJob(input);
    expect(enqueued.completed).toBe(true);
    expect(enqueued.artifact?.url).toContain("memory://");
    expect(billingLog.confirms).toHaveLength(1);
    expect(billingLog.releases).toEqual([]);
  });

  it("enqueues slow formats and confirms only after the worker runs", async () => {
    const { system, billingLog } = build("slow");
    const enqueued = await system.service.createExportJob(input);
    expect(enqueued.completed).toBe(false);
    expect(enqueued.status).toBe("QUEUED");
    expect(billingLog.confirms).toEqual([]);

    await system.processor.process(enqueued.jobId);
    const finished = await system.store.get(enqueued.jobId);
    expect(finished?.status).toBe("SUCCEEDED");
    expect(billingLog.confirms).toHaveLength(1);
  });

  it("cancelling a queued job refunds the billing hold", async () => {
    const { system, billingLog } = build("slow");
    const enqueued = await system.service.createExportJob(input);
    expect(enqueued.completed).toBe(false);

    const cancelled = await system.service.cancelJob("user-1", enqueued.jobId);
    expect(cancelled.status).toBe("CANCELLED");
    expect(billingLog.releases).toHaveLength(1);
    expect(billingLog.releases[0].id).toBe(`evt-${enqueued.jobId}`);
    expect(billingLog.confirms).toEqual([]);
  });

  it("enforces ownership on getJob", async () => {
    const { system } = build("slow");
    const enqueued = await system.service.createExportJob(input);
    const owned = await system.service.getJob("user-1", enqueued.jobId);
    const foreign = await system.service.getJob("other-user", enqueued.jobId);
    expect(owned?.id).toBe(enqueued.jobId);
    expect(foreign).toBeNull();
  });
});
