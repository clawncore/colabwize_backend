import { Readable } from "stream";
import type {
  Destination,
  DestinationAdapter,
  DestinationPushContext,
  DestinationResult,
} from "./types";

/**
 * Minimal upload surface a cloud provider must satisfy. Mirrors the existing
 * `IStorageProvider.uploadFile` so the adapter can wrap `CloudStorageFacade`
 * without a hard dependency (injected for tests).
 */
export interface CloudUploader {
  uploadFile(
    userId: string,
    fileName: string,
    stream: Readable,
    mimeType: string,
  ): Promise<{ id?: string; name?: string; webUrl?: string }>;
}

/**
 * CloudStorageDestinationAdapter — pushes the artifact bytes to a cloud
 * provider (Google Drive, OneDrive, Supabase, …) via an injected `CloudUploader`.
 *
 * The provider name is carried so the result is attributable; the actual
 * transport (OAuth token, SDK) lives behind the uploader.
 */
export class CloudStorageDestinationAdapter implements DestinationAdapter {
  constructor(
    readonly destination: Destination,
    private readonly uploader: CloudUploader,
  ) {}

  async push(ctx: DestinationPushContext): Promise<DestinationResult> {
    const bytes = await ctx.getBytes();
    const stream = Readable.from(bytes);
    const result = await this.uploader.uploadFile(
      ctx.userId,
      ctx.fileName,
      stream,
      ctx.mimeType,
    );
    return {
      destination: this.destination,
      ok: true,
      remoteUrl: result.webUrl ?? result.id,
      message: `Uploaded to ${this.destination}`,
    };
  }
}
