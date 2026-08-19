import { createHash } from "node:crypto";
import { OutputFormat } from "../../cdm";
import { GenResult, MIME_TYPES } from "../../types";

/** Build a GenResult with mime type and sha-256 checksum. */
export function buildResult(format: OutputFormat, buffer: Buffer): GenResult {
  return {
    format,
    buffer,
    mimeType: MIME_TYPES[format],
    sizeBytes: buffer.length,
    checksum: createHash("sha256").update(buffer).digest("hex"),
  };
}
