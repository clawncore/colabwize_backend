import { publishingEngine } from "../engine";
import { JobEventBus, ExportJobWorker } from "./queue";
import { ExportJobProcessor } from "./processor";
import {
  ExportJobService,
  BillingGatewayClient,
  type BillingClient,
  type ExportEngineLike,
} from "./service";
import { createExportJobStore, type ExportJobStore } from "./store";
import { createArtifactStore, type ArtifactStore } from "./artifactStore";
import { createCdmResolver, type CdmResolver } from "./cdmResolver";
import {
  createTemplateResolver,
  type TemplateResolver,
} from "../templates/engine";
import {
  createDestinationRegistry,
  type DestinationRegistry,
} from "../destinations";

export interface ExportJobSystemOptions {
  store?: ExportJobStore;
  artifactStore?: ArtifactStore;
  resolver?: CdmResolver;
  engine?: ExportEngineLike;
  bus?: JobEventBus;
  billing?: BillingClient;
  worker?: ExportJobWorker;
  templateResolver?: TemplateResolver;
  /** Phase 5: destination delivery registry. */
  destinationRegistry?: DestinationRegistry;
  /** Polling interval (ms) for the async worker loop. */
  pollMs?: number;
}

export interface ExportJobSystem {
  store: ExportJobStore;
  artifactStore: ArtifactStore;
  resolver: CdmResolver;
  engine: ExportEngineLike;
  bus: JobEventBus;
  processor: ExportJobProcessor;
  worker: ExportJobWorker;
  service: ExportJobService;
  templateResolver: TemplateResolver;
  destinationRegistry: DestinationRegistry;
}

/**
 * Wire the full export job system with production defaults, overriding any
 * component for testing (the Strangler-Fig seam). The worker is created but
 * NOT auto-started — call `system.worker.start()` (or `service.startWorker()`)
 * from the server bootstrap so it only runs in app processes that should run
 * jobs (not e.g. a pure API replica, if you ever split them).
 */
export function createExportJobSystem(
  opts: ExportJobSystemOptions = {},
): ExportJobSystem {
  const store = opts.store ?? createExportJobStore();
  const artifactStore = opts.artifactStore ?? createArtifactStore();
  const resolver = opts.resolver ?? createCdmResolver();
  const engine = opts.engine ?? (publishingEngine as unknown as ExportEngineLike);
  const bus = opts.bus ?? new JobEventBus();
  const billing = opts.billing ?? new BillingGatewayClient();
  const templateResolver = opts.templateResolver ?? createTemplateResolver();
  const destinationRegistry =
    opts.destinationRegistry ?? createDestinationRegistry();

  const processor = new ExportJobProcessor({
    store,
    artifactStore,
    resolver,
    engine,
    bus,
    confirmBilling: (id: string) => billing.confirm(id),
    releaseBilling: (id: string, reason?: string) => billing.release(id, reason),
    destinationRegistry,
  });

  const worker =
    opts.worker ?? new ExportJobWorker(store, processor, { pollMs: opts.pollMs });

  const service = new ExportJobService({
    store,
    resolver,
    engine,
    bus,
    worker,
    billing,
    templateResolver,
  });

  return {
    store,
    artifactStore,
    resolver,
    engine,
    bus,
    processor,
    worker,
    service,
    templateResolver,
    destinationRegistry,
  };
}

export { ExportJobService } from "./service";
export type {
  ExportJobStore,
  InMemoryExportJobStore,
  PrismaExportJobStore,
} from "./store";
export type { ArtifactStore, InMemoryArtifactStore, SupabaseArtifactStore } from "./artifactStore";
export type { CdmResolver, PrismaCdmResolver, InMemoryCdmResolver } from "./cdmResolver";
export { JobEventBus, ExportJobWorker } from "./queue";
export { ExportJobProcessor, type PublishingEngineLike } from "./processor";
export { createPublishingRouter } from "./router";
export {
  createDestinationRegistry,
  InMemoryDestinationRegistry,
  type DestinationRegistry,
  type DestinationAdapter,
  type Destination,
  type DestinationResult,
  type DestinationPushContext,
  type CloudUploader,
} from "../destinations";
export type {
  ExportJobRecord,
  ExportJobStatus,
  ExportJobSettings,
  ExportJobProgressEvent,
  CreateExportJobInput,
  ExportJobEnqueued,
  ArtifactDescriptor,
  isTerminal,
  normalizeFormat,
} from "./types";
