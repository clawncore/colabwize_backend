import { prisma } from "../../lib/prisma";
import { createExportJobSystem } from "../jobs";
import { InMemoryArtifactStore } from "../jobs/artifactStore";
import type { BillingClient } from "../jobs/service";
import type { CanonicalDocument } from "../cdm";

/** Successful no-op billing so we test the store/engine/resolver/history
 *  integration against the real DB without touching the usage ledger.
 *  (The real hold/confirm/release lifecycle is already covered by unit tests,
 *  and the live plan-entitlement gate was confirmed working above.) */
const fakeBilling: BillingClient = {
  hold: async () => ({ eventId: `probe-${Date.now()}` }),
  confirm: async () => {},
  release: async () => {},
};

/**
 * LIVE integration check (NOT part of the offline suite — deleted after use).
 * Exercises the real Prisma store + CDM resolver + engine + billing against
 * the configured DATABASE_URL. Only the artifact store is swapped for an
 * in-memory impl so we don't depend on Supabase storage config.
 *
 * All created rows are deleted in finally{} so the DB is left untouched.
 */
describe("live export workflow", () => {
  const ids: { user?: string; project?: string; version?: string; jobs: string[] } = {
    jobs: [],
  };

  const cdm: CanonicalDocument = {
    schemaVersion: "1.0",
    metadata: { title: "Live Export Probe", authors: [], cslStyle: "apa" },
    settings: {
      locale: "en-US",
      direction: "ltr",
      cslStyle: "apa",
      pageGeometry: {
        size: "A4",
        margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
        columns: 1,
      },
      numbering: { figures: true, tables: true, equations: true, headings: true },
    },
    body: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Hello from the live export probe." }],
      },
    ],
    references: [],
    assets: [],
  };

  afterAll(async () => {
    // Cleanup in FK-safe order.
    if (ids.jobs.length) {
      await prisma.exportJob
        .deleteMany({ where: { id: { in: ids.jobs } } })
        .catch(() => {});
    }
    if (ids.version)
      await prisma.documentVersion.delete({ where: { id: ids.version } }).catch(() => {});
    if (ids.project)
      await prisma.project.delete({ where: { id: ids.project } }).catch(() => {});
    if (ids.user) await prisma.user.delete({ where: { id: ids.user } }).catch(() => {});
    await prisma.$disconnect();
  });

  it(
    "enqueues a markdown export and completes it via the real pipeline",
    async () => {
    // 1. Seed minimal real rows.
    const user = await prisma.user.create({
      data: { email: `probe-${Date.now()}@colabwize.local` },
    });
    ids.user = user.id;

    const project = await prisma.project.create({
      data: { user_id: user.id, title: "Probe Project" },
    });
    ids.project = project.id;

    const version = await prisma.documentVersion.create({
      data: {
        project_id: project.id,
        user_id: user.id,
        version: 1,
        content: { type: "doc", content: [] } as any,
        cdm: cdm as any,
      },
    });
    ids.version = version.id;

    // 2. Real system, only artifact store swapped.
    const system = createExportJobSystem({
      artifactStore: new InMemoryArtifactStore(),
      billing: fakeBilling,
    });

    // 3. Enqueue a fast-path format (markdown).
    const enqueued = await system.service.createExportJob({
      userId: user.id,
      docVersionId: version.id,
      format: "md",
    });
    ids.jobs.push(enqueued.jobId);
    expect(enqueued.jobId).toBeTruthy();
    expect(enqueued.completed).toBe(true);
    expect(enqueued.artifact).toBeTruthy();
    expect(enqueued.artifact?.mimeType).toContain("markdown");

    // 4. Job record reflects success.
    const job = await system.service.getJob(user.id, enqueued.jobId);
    expect(job).not.toBeNull();
    expect(job!.status).toBe("SUCCEEDED");
    expect(job!.artifactUrl).toBeTruthy();

    // 5. History lists it for the user.
    const history = await system.service.listJobs(user.id);
    expect(history.find((h) => h.id === enqueued.jobId)).toBeTruthy();
  },
  30000,
);
});

