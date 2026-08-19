import { SupabaseStorageService } from "../../services/supabaseStorageService";
import logger from "../../monitoring/logger";

/**
 * ArtifactStore — where finished export artifacts live.
 *
 * Production uses Supabase Storage (private bucket) and hands back a
 * time-limited **signed** download URL (gap C2: signed expiring URLs, not
 * permanent public links). The store is injected so workers can be tested
 * without a storage backend (InMemoryArtifactStore).
 */
export interface ArtifactStore {
  /** Persist the generated buffer; returns the path + a signed download URL. */
  put(input: {
    userId: string;
    jobId: string;
    fileName: string;
    buffer: Buffer;
    mimeType: string;
    /** Signed-URL lifetime in seconds. */
    expiresIn?: number;
  }): Promise<{ path: string; url: string }>;

  /** Refresh / mint a signed URL for a previously stored artifact path. */
  signedUrl(path: string, expiresIn?: number): Promise<string>;
}

export class SupabaseArtifactStore implements ArtifactStore {
  constructor(private readonly defaultExpirySeconds = 3600) {}

  async put(input: {
    userId: string;
    jobId: string;
    fileName: string;
    buffer: Buffer;
    mimeType: string;
    expiresIn?: number;
  }): Promise<{ path: string; url: string }> {
    const intendedPath = `${input.userId}/exports/${input.jobId}/${input.fileName}`;
    // uploadFile mints its own unique storage key (it ignores the path we pass
    // and returns the real one), so mint the signed URL against the path it
    // actually stored the object at — otherwise the URL points at a path that
    // was never written and the download fails with "Failed to mint signed URL".
    const uploaded = await SupabaseStorageService.uploadFile(
      input.buffer,
      intendedPath,
      input.mimeType,
      input.userId,
    );
    const url = await this.signedUrl(uploaded.path, input.expiresIn);
    return { path: uploaded.path, url };
  }

  async signedUrl(path: string, expiresIn?: number): Promise<string> {
    try {
      return await SupabaseStorageService.createSignedUrl(
        path,
        expiresIn ?? this.defaultExpirySeconds,
        { download: path.split("/").pop() ?? true },
      );
    } catch (e: any) {
      logger.error("Failed to mint signed artifact URL", {
        path,
        error: e.message,
      });
      throw new Error(`Failed to mint signed URL: ${e.message}`);
    }
  }
}

export interface StoredArtifact {
  path: string;
  buffer: Buffer;
  mimeType: string;
  url: string;
}

export class InMemoryArtifactStore implements ArtifactStore {
  private artifacts = new Map<string, StoredArtifact>();

  async put(input: {
    userId: string;
    jobId: string;
    fileName: string;
    buffer: Buffer;
    mimeType: string;
    expiresIn?: number;
  }): Promise<{ path: string; url: string }> {
    const path = `${input.userId}/exports/${input.jobId}/${input.fileName}`;
    const url = `memory://${path}`;
    this.artifacts.set(path, {
      path,
      buffer: input.buffer,
      mimeType: input.mimeType,
      url,
    });
    return { path, url };
  }

  async signedUrl(path: string): Promise<string> {
    const found = this.artifacts.get(path);
    if (!found) throw new Error(`Artifact not found: ${path}`);
    return found.url;
  }

  /** Test helper: read back what was stored. */
  getBuffer(path: string): Buffer | undefined {
    return this.artifacts.get(path)?.buffer;
  }
}

export function createArtifactStore(): ArtifactStore {
  return new SupabaseArtifactStore();
}
