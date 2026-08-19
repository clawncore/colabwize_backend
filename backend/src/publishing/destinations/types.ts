/**
 * Phase 5 — Destination Adapters.
 *
 * A `DestinationAdapter` knows how to deliver a finished export artifact to a
 * single destination (local download, a cloud drive, a repository, an archive,
 * …). The export job processor resolves the requested destination by name from
 * a `DestinationRegistry` and pushes the artifact bytes after they are stored.
 *
 * Every adapter is injected (no hard SDK dependency), so the job lifecycle is
 * unit-tested without real cloud credentials. New providers (Dropbox/Box/
 * Overleaf/GitHub/Zenodo) are added by implementing this one interface — the
 * processor and billing lifecycle are unchanged (Strangler-Fig seam).
 */

/** Known destinations. New providers extend this union. */
export type Destination =
  | "local"
  | "google-drive"
  | "onedrive"
  | "supabase"
  | "dropbox"
  | "box"
  | "overleaf"
  | "github"
  | "zenodo";

/** Context handed to an adapter when pushing an artifact. */
export interface DestinationPushContext {
  userId: string;
  jobId: string;
  /** File name to use at the destination (e.g. `document.pdf`). */
  fileName: string;
  mimeType: string;
  /** Lazily fetch the artifact bytes (only called by adapters that upload). */
  getBytes: () => Promise<Buffer>;
  /** URL of the artifact already stored by the ArtifactStore (used by local). */
  artifactUrl: string;
}

export interface DestinationResult {
  destination: Destination;
  ok: boolean;
  /** Provider-side URL / id for the pushed file, when available. */
  remoteUrl?: string;
  message?: string;
}

export interface DestinationAdapter {
  readonly destination: Destination;
  push(ctx: DestinationPushContext): Promise<DestinationResult>;
}
