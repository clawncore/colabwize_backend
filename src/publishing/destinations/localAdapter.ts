import type {
  Destination,
  DestinationAdapter,
  DestinationPushContext,
  DestinationResult,
} from "./types";

/**
 * LocalDestinationAdapter — the "download to the user's device" destination.
 *
 * No external push is needed: the artifact is already in the ArtifactStore and
 * its signed URL is returned by the processor. This adapter simply echoes that
 * URL back so the registry has a uniform shape for every destination.
 */
export class LocalDestinationAdapter implements DestinationAdapter {
  readonly destination: Destination = "local";

  async push(ctx: DestinationPushContext): Promise<DestinationResult> {
    return {
      destination: "local",
      ok: true,
      remoteUrl: ctx.artifactUrl,
      message: "Stored locally; download URL ready.",
    };
  }
}
