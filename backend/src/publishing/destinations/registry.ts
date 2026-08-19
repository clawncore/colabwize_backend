import type { Destination, DestinationAdapter } from "./types";
import { LocalDestinationAdapter } from "./localAdapter";
import { CloudStorageDestinationAdapter, type CloudUploader } from "./cloudStorageAdapter";

/**
 * DestinationRegistry — name → adapter lookup used by the processor to resolve
 * the destination requested on a job. Injected so tests use a registry of fakes
 * and production can wrap the real cloud providers.
 */
export interface DestinationRegistry {
  get(destination: Destination): DestinationAdapter | undefined;
  list(): DestinationAdapter[];
}

export class InMemoryDestinationRegistry implements DestinationRegistry {
  private readonly adapters: Map<Destination, DestinationAdapter>;

  constructor(adapters: DestinationAdapter[] = []) {
    this.adapters = new Map(adapters.map((a) => [a.destination, a]));
  }

  get(destination: Destination): DestinationAdapter | undefined {
    return this.adapters.get(destination);
  }

  list(): DestinationAdapter[] {
    return [...this.adapters.values()];
  }

  /** Test/helper hook: register an extra adapter at runtime. */
  register(adapter: DestinationAdapter): void {
    this.adapters.set(adapter.destination, adapter);
  }
}

export interface DestinationRegistryOptions {
  /** Override the uploader for a given cloud destination (tests / future SDKs). */
  uploaders?: Partial<Record<Destination, CloudUploader>>;
}

/**
 * Build the default registry: local download + the cloud providers already
 * wired through `CloudStorageFacade` (Google Drive, OneDrive, Supabase).
 *
 * Dropbox/Box/Overleaf/GitHub/Zenodo are intentionally NOT registered yet —
 * they require new OAuth clients / SDKs (sandbox-blocked) and are added by
 * implementing `DestinationAdapter` and registering them here once available.
 */
export function createDestinationRegistry(
  opts: DestinationRegistryOptions = {},
): DestinationRegistry {
  const adapters: DestinationAdapter[] = [new LocalDestinationAdapter()];

  // Lazy require keeps the heavy provider graph out of unit-test imports.
  if (opts.uploaders || process.env.SKIP_CLOUD_PROVIDERS !== "true") {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CloudStorageFacade } = require("../../services/storage/CloudStorageFacade");
    const map: Array<[Destination, "google-drive" | "onedrive" | "supabase"]> = [
      ["google-drive", "google-drive"],
      ["onedrive", "onedrive"],
      ["supabase", "supabase"],
    ];
    for (const [destination, provider] of map) {
      const uploader =
        opts.uploaders?.[destination] ?? CloudStorageFacade.getProvider(provider);
      adapters.push(new CloudStorageDestinationAdapter(destination, uploader));
    }
  }

  return new InMemoryDestinationRegistry(adapters);
}
