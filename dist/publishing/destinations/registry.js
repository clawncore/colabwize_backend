"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryDestinationRegistry = void 0;
exports.createDestinationRegistry = createDestinationRegistry;
const localAdapter_1 = require("./localAdapter");
const cloudStorageAdapter_1 = require("./cloudStorageAdapter");
class InMemoryDestinationRegistry {
    adapters;
    constructor(adapters = []) {
        this.adapters = new Map(adapters.map((a) => [a.destination, a]));
    }
    get(destination) {
        return this.adapters.get(destination);
    }
    list() {
        return [...this.adapters.values()];
    }
    /** Test/helper hook: register an extra adapter at runtime. */
    register(adapter) {
        this.adapters.set(adapter.destination, adapter);
    }
}
exports.InMemoryDestinationRegistry = InMemoryDestinationRegistry;
/**
 * Build the default registry: local download + the cloud providers already
 * wired through `CloudStorageFacade` (Google Drive, OneDrive, Supabase).
 *
 * Dropbox/Box/Overleaf/GitHub/Zenodo are intentionally NOT registered yet —
 * they require new OAuth clients / SDKs (sandbox-blocked) and are added by
 * implementing `DestinationAdapter` and registering them here once available.
 */
function createDestinationRegistry(opts = {}) {
    const adapters = [new localAdapter_1.LocalDestinationAdapter()];
    // Lazy require keeps the heavy provider graph out of unit-test imports.
    if (opts.uploaders || process.env.SKIP_CLOUD_PROVIDERS !== "true") {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { CloudStorageFacade } = require("../../services/storage/CloudStorageFacade");
        const map = [
            ["google-drive", "google-drive"],
            ["onedrive", "onedrive"],
            ["supabase", "supabase"],
        ];
        for (const [destination, provider] of map) {
            const uploader = opts.uploaders?.[destination] ?? CloudStorageFacade.getProvider(provider);
            adapters.push(new cloudStorageAdapter_1.CloudStorageDestinationAdapter(destination, uploader));
        }
    }
    return new InMemoryDestinationRegistry(adapters);
}
