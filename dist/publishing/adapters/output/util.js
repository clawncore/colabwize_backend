"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildResult = buildResult;
const node_crypto_1 = require("node:crypto");
const types_1 = require("../../types");
/** Build a GenResult with mime type and sha-256 checksum. */
function buildResult(format, buffer) {
    return {
        format,
        buffer,
        mimeType: types_1.MIME_TYPES[format],
        sizeBytes: buffer.length,
        checksum: (0, node_crypto_1.createHash)("sha256").update(buffer).digest("hex"),
    };
}
