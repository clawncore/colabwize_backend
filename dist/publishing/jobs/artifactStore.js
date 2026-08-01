"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryArtifactStore = exports.SupabaseArtifactStore = void 0;
exports.createArtifactStore = createArtifactStore;
const supabaseStorageService_1 = require("../../services/supabaseStorageService");
const logger_1 = __importDefault(require("../../monitoring/logger"));
class SupabaseArtifactStore {
    defaultExpirySeconds;
    constructor(defaultExpirySeconds = 3600) {
        this.defaultExpirySeconds = defaultExpirySeconds;
    }
    async put(input) {
        const intendedPath = `${input.userId}/exports/${input.jobId}/${input.fileName}`;
        // uploadFile mints its own unique storage key (it ignores the path we pass
        // and returns the real one), so mint the signed URL against the path it
        // actually stored the object at — otherwise the URL points at a path that
        // was never written and the download fails with "Failed to mint signed URL".
        const uploaded = await supabaseStorageService_1.SupabaseStorageService.uploadFile(input.buffer, intendedPath, input.mimeType, input.userId);
        const url = await this.signedUrl(uploaded.path, input.expiresIn);
        return { path: uploaded.path, url };
    }
    async signedUrl(path, expiresIn) {
        try {
            return await supabaseStorageService_1.SupabaseStorageService.createSignedUrl(path, expiresIn ?? this.defaultExpirySeconds, { download: path.split("/").pop() ?? true });
        }
        catch (e) {
            logger_1.default.error("Failed to mint signed artifact URL", {
                path,
                error: e.message,
            });
            throw new Error(`Failed to mint signed URL: ${e.message}`);
        }
    }
}
exports.SupabaseArtifactStore = SupabaseArtifactStore;
class InMemoryArtifactStore {
    artifacts = new Map();
    async put(input) {
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
    async signedUrl(path) {
        const found = this.artifacts.get(path);
        if (!found)
            throw new Error(`Artifact not found: ${path}`);
        return found.url;
    }
    /** Test helper: read back what was stored. */
    getBuffer(path) {
        return this.artifacts.get(path)?.buffer;
    }
}
exports.InMemoryArtifactStore = InMemoryArtifactStore;
function createArtifactStore() {
    return new SupabaseArtifactStore();
}
