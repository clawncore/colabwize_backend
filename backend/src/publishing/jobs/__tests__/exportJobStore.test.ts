import {
  InMemoryExportJobStore,
  type ExportJobStore,
} from "../store";
import type { ExportJobSettings } from "../types";

function makeStore(): ExportJobStore {
  return new InMemoryExportJobStore();
}

const base = {
  id: "job-1",
  userId: "user-1",
  projectId: null,
  docVersionId: "dv-1",
  format: "pdf",
  settings: {} as ExportJobSettings,
  billingEventId: "evt-1",
};

describe("InMemoryExportJobStore", () => {
  it("creates a QUEUED job and round-trips it", async () => {
    const store = makeStore();
    const created = await store.create(base);
    expect(created.status).toBe("QUEUED");
    expect(created.attempts).toBe(0);
    expect(created.maxAttempts).toBe(3);

    const fetched = await store.get("job-1");
    expect(fetched?.id).toBe("job-1");
    expect(fetched?.billingEventId).toBe("evt-1");
  });

  it("lists jobs by user, newest first", async () => {
    const store = makeStore();
    const first = await store.create(base);
    // Force a strictly-later createdAt so ordering is deterministic.
    first.createdAt = new Date(Date.now() - 10_000);
    await store.create({ ...base, id: "job-2", docVersionId: "dv-2" });
    const list = await store.getByUser("user-1");
    expect(list.map((j) => j.id)).toEqual(["job-2", "job-1"]);
  });

  it("claimNext atomically flips QUEUED -> RUNNING (no double-claim)", async () => {
    const store = makeStore();
    await store.create(base);
    const claimed = await store.claimNext();
    expect(claimed?.id).toBe("job-1");
    expect(claimed?.status).toBe("RUNNING");
    expect(claimed?.startedAt).not.toBeNull();

    // Nothing left to claim (it is now RUNNING, not QUEUED/RETRYING).
    const second = await store.claimNext();
    expect(second).toBeNull();
  });

  it("re-claimable only when RETRYING, and increments attempts on execution", async () => {
    const store = makeStore();
    const job = await store.create(base);
    expect((await store.claimNext())?.status).toBe("RUNNING");
    await store.setStatus(job.id, "RETRYING");
    const reclaimed = await store.claimNext();
    expect(reclaimed?.id).toBe("job-1");
    // Attempts are owned by the processor, incremented per execution:
    const bumped = await store.incrementAttempt(job.id);
    expect(bumped.attempts).toBe(1);
  });

  it("stores artifact metadata and marks completion", async () => {
    const store = makeStore();
    const job = await store.create(base);
    await store.setArtifact(job.id, {
      path: "p",
      url: "u",
      mimeType: "application/pdf",
      size: 10,
      checksum: "deadbeef",
    });
    const completed = await store.markCompleted(job.id);
    expect(completed.status).toBe("SUCCEEDED");
    expect(completed.progress).toBe(100);
    expect(completed.artifactUrl).toBe("u");
    expect(completed.artifactChecksum).toBe("deadbeef");
    expect(completed.completedAt).not.toBeNull();
  });
});
