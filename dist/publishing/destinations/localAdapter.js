"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalDestinationAdapter = void 0;
/**
 * LocalDestinationAdapter — the "download to the user's device" destination.
 *
 * No external push is needed: the artifact is already in the ArtifactStore and
 * its signed URL is returned by the processor. This adapter simply echoes that
 * URL back so the registry has a uniform shape for every destination.
 */
class LocalDestinationAdapter {
    destination = "local";
    async push(ctx) {
        return {
            destination: "local",
            ok: true,
            remoteUrl: ctx.artifactUrl,
            message: "Stored locally; download URL ready.",
        };
    }
}
exports.LocalDestinationAdapter = LocalDestinationAdapter;
