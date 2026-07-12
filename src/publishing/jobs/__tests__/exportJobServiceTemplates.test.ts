import { createExportJobSystem } from "../index";
import type { ExportEngineLike } from "../service";
import type { TemplateResolver } from "../../templates/engine";
import type { ResolvedTemplate } from "../../templates/types";
import { InMemoryExportJobStore } from "../store";
import { InMemoryArtifactStore } from "../artifactStore";
import { InMemoryCdmResolver } from "../cdmResolver";
import { JobEventBus } from "../queue";
import { makeSampleCdm } from "../../test-utils/fixtures";
import type { GenResult } from "../../types";
import type { BillingClient } from "../service";

const TPL: ResolvedTemplate = {
  id: "t1",
  name: "IEEE PDF",
  isBuiltin: false,
  format: "pdf",
  cslStyle: "ieee",
  geometry: {
    size: "A4",
    margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
    columns: 1,
  },
  variables: [],
};

const fakeTemplateResolver: TemplateResolver = {
  resolve: async (id) => ({ ...TPL, id }),
  list: async () => [TPL],
  create: async () => TPL,
};

describe("ExportJobService + template resolution", () => {
  function build() {
    const engine: ExportEngineLike = {
      generate: (): Promise<GenResult> =>
        Promise.resolve({
          format: "pdf",
          buffer: Buffer.from("x"),
          mimeType: "application/pdf",
          sizeBytes: 1,
          checksum: "c",
        }),
      getAdapter: () => ({ estimateComplexity: () => "fast" }),
    };
    const billing: BillingClient = {
      hold: async (userId, referenceId) => ({ eventId: `evt-${referenceId}` }),
      confirm: async () => {},
      release: async () => {},
    };
    const system = createExportJobSystem({
      store: new InMemoryExportJobStore(),
      artifactStore: new InMemoryArtifactStore(),
      resolver: InMemoryCdmResolver.fromFixture("dv-1", makeSampleCdm()),
      engine,
      bus: new JobEventBus(),
      billing,
      templateResolver: fakeTemplateResolver,
    });
    return system;
  }

  it("merges a template's CSL style + citeproc into job settings", async () => {
    const system = build();
    const enqueued = await system.service.createExportJob({
      userId: "u1",
      docVersionId: "dv-1",
      format: "pdf",
      settings: { templateId: "t1" },
    });
    const job = await system.store.get(enqueued.jobId);
    expect(job?.settings.cslStyle).toBe("ieee");
    expect(job?.settings.enableCiteproc).toBe(true);
    expect(job?.settings.templateId).toBe("t1");
  });

  it("explicit settings win over the template defaults", async () => {
    const system = build();
    const enqueued = await system.service.createExportJob({
      userId: "u1",
      docVersionId: "dv-1",
      format: "pdf",
      settings: { templateId: "t1", cslStyle: "mla" },
    });
    const job = await system.store.get(enqueued.jobId);
    expect(job?.settings.cslStyle).toBe("mla"); // explicit beats template
    expect(job?.settings.enableCiteproc).toBe(true);
  });
});
