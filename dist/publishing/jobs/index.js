"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryDestinationRegistry = exports.createDestinationRegistry = exports.createPublishingRouter = exports.ExportJobProcessor = exports.ExportJobWorker = exports.JobEventBus = exports.ExportJobService = void 0;
exports.createExportJobSystem = createExportJobSystem;
const engine_1 = require("../engine");
const queue_1 = require("./queue");
const processor_1 = require("./processor");
const service_1 = require("./service");
const store_1 = require("./store");
const artifactStore_1 = require("./artifactStore");
const cdmResolver_1 = require("./cdmResolver");
const engine_2 = require("../templates/engine");
const destinations_1 = require("../destinations");
/**
 * Wire the full export job system with production defaults, overriding any
 * component for testing (the Strangler-Fig seam). The worker is created but
 * NOT auto-started — call `system.worker.start()` (or `service.startWorker()`)
 * from the server bootstrap so it only runs in app processes that should run
 * jobs (not e.g. a pure API replica, if you ever split them).
 */
function createExportJobSystem(opts = {}) {
    const store = opts.store ?? (0, store_1.createExportJobStore)();
    const artifactStore = opts.artifactStore ?? (0, artifactStore_1.createArtifactStore)();
    const resolver = opts.resolver ?? (0, cdmResolver_1.createCdmResolver)();
    const engine = opts.engine ?? engine_1.publishingEngine;
    const bus = opts.bus ?? new queue_1.JobEventBus();
    const billing = opts.billing ?? new service_1.BillingGatewayClient();
    const templateResolver = opts.templateResolver ?? (0, engine_2.createTemplateResolver)();
    const destinationRegistry = opts.destinationRegistry ?? (0, destinations_1.createDestinationRegistry)();
    const processor = new processor_1.ExportJobProcessor({
        store,
        artifactStore,
        resolver,
        engine,
        bus,
        confirmBilling: (id) => billing.confirm(id),
        releaseBilling: (id, reason) => billing.release(id, reason),
        destinationRegistry,
    });
    const worker = opts.worker ?? new queue_1.ExportJobWorker(store, processor, { pollMs: opts.pollMs });
    const service = new service_1.ExportJobService({
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
var service_2 = require("./service");
Object.defineProperty(exports, "ExportJobService", { enumerable: true, get: function () { return service_2.ExportJobService; } });
var queue_2 = require("./queue");
Object.defineProperty(exports, "JobEventBus", { enumerable: true, get: function () { return queue_2.JobEventBus; } });
Object.defineProperty(exports, "ExportJobWorker", { enumerable: true, get: function () { return queue_2.ExportJobWorker; } });
var processor_2 = require("./processor");
Object.defineProperty(exports, "ExportJobProcessor", { enumerable: true, get: function () { return processor_2.ExportJobProcessor; } });
var router_1 = require("./router");
Object.defineProperty(exports, "createPublishingRouter", { enumerable: true, get: function () { return router_1.createPublishingRouter; } });
var destinations_2 = require("../destinations");
Object.defineProperty(exports, "createDestinationRegistry", { enumerable: true, get: function () { return destinations_2.createDestinationRegistry; } });
Object.defineProperty(exports, "InMemoryDestinationRegistry", { enumerable: true, get: function () { return destinations_2.InMemoryDestinationRegistry; } });
