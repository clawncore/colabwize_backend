"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudStorageDestinationAdapter = void 0;
const stream_1 = require("stream");
/**
 * CloudStorageDestinationAdapter — pushes the artifact bytes to a cloud
 * provider (Google Drive, OneDrive, Supabase, …) via an injected `CloudUploader`.
 *
 * The provider name is carried so the result is attributable; the actual
 * transport (OAuth token, SDK) lives behind the uploader.
 */
class CloudStorageDestinationAdapter {
    destination;
    uploader;
    constructor(destination, uploader) {
        this.destination = destination;
        this.uploader = uploader;
    }
    async push(ctx) {
        const bytes = await ctx.getBytes();
        const stream = stream_1.Readable.from(bytes);
        const result = await this.uploader.uploadFile(ctx.userId, ctx.fileName, stream, ctx.mimeType);
        return {
            destination: this.destination,
            ok: true,
            remoteUrl: result.webUrl ?? result.id,
            message: `Uploaded to ${this.destination}`,
        };
    }
}
exports.CloudStorageDestinationAdapter = CloudStorageDestinationAdapter;
