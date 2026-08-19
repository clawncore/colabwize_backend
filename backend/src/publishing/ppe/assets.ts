/**
 * Figure asset extraction.
 *
 * Best-effort resolution of each figure's `src` into raw bytes so the package
 * can ship an `Images/` folder. Supported sources:
 *   - `data:` URIs (inline images from the editor),
 *   - `http(s)://` URLs (fetched with a timeout),
 *   - storage keys (delegated to an injected resolver; unresolved → warning).
 *
 * The function never throws on a single failure — it returns `bytes: null` plus
 * a warning so the rest of the package still builds. Color space / dimensions
 * are probed for quality gating (see `quality.ts`).
 */
import type { CanonicalDocument, Figure } from "../cdm";

export type ColorSpace = "rgb" | "cmyk" | "grayscale" | "unknown";

export interface ExtractedAsset {
  id: string;
  src: string;
  bytes: Buffer | null;
  ext?: string;
  mime?: string;
  width?: number;
  height?: number;
  dpi?: number;
  colorSpace: ColorSpace;
  warnings: string[];
}

export interface ExtractAssetsOptions {
  timeoutMs?: number;
  /** Resolve a storage key / relative path to bytes (prod: supabase/storage). */
  resolveStorage?: (key: string) => Promise<Buffer | null>;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/tiff": "tif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

function extFromMime(mime?: string): string | undefined {
  if (!mime) return undefined;
  return MIME_TO_EXT[mime.toLowerCase()] ?? mime.split("/")[1]?.split("+")[0];
}

function extFromUrl(url: string): string | undefined {
  const clean = url.split("?")[0].split("#")[0];
  const m = clean.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : undefined;
}

async function fetchBytes(
  src: string,
  timeoutMs: number,
): Promise<{ bytes: Buffer; mime?: string; ext?: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(src, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type")?.split(";")[0] ?? undefined;
    return { bytes: buf, mime, ext: extFromMime(mime) ?? extFromUrl(src) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseDataUri(
  src: string,
): { bytes: Buffer; mime?: string; ext?: string } | null {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const isBase64 = !!m[2];
  const data = m[3];
  try {
    const bytes = isBase64
      ? Buffer.from(data, "base64")
      : Buffer.from(decodeURIComponent(data));
    return { bytes, mime, ext: extFromMime(mime) };
  } catch {
    return null;
  }
}

/** Probe color space without external deps (JPEG components / TIFF photometric). */
function detectColorSpace(bytes: Buffer, ext?: string): ColorSpace {
  const e = ext ?? "";
  if (e === "jpg" || e === "jpeg") {
    // Walk JPEG markers; SOF markers carry the component count.
    let i = 2;
    while (i + 3 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = bytes[i + 1];
      // SOF0..SOF15 excluding APP14(0xEE)
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        const components = bytes[i + 9];
        if (components === 4) return "cmyk";
        if (components === 1) return "grayscale";
        return "rgb";
      }
      const len = bytes.readUInt16BE(i + 2);
      i += 2 + len;
    }
    return "unknown";
  }
  if (e === "tif" || e === "tiff") {
    if (bytes.length < 8) return "unknown";
    const little = bytes.readUInt16LE(0) === 0x4949;
    const read16 = (off: number) => (little ? bytes.readUInt16LE(off) : bytes.readUInt16BE(off));
    const read32 = (off: number) => (little ? bytes.readUInt32LE(off) : bytes.readUInt32BE(off));
    let ifdOffset = read32(4);
    if (ifdOffset + 2 > bytes.length) return "unknown";
    const entries = read16(ifdOffset);
    for (let n = 0; n < entries; n += 1) {
      const entry = ifdOffset + 2 + n * 12;
      if (entry + 12 > bytes.length) break;
      const tag = read16(entry);
      if (tag === 262) {
        const val = read16(entry + 8);
        if (val === 5) return "cmyk";
        if (val === 2) return "rgb";
        if (val === 1 || val === 0) return "grayscale";
      }
    }
    return "unknown";
  }
  return "unknown";
}

function tryImageSize(bytes: Buffer, ext?: string): { width?: number; height?: number } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sizeOf = require("image-size");
    const d = sizeOf(bytes, ext ? { type: ext as never } : undefined);
    return { width: d.width, height: d.height };
  } catch {
    return {};
  }
}

function srcKind(src: string): "data" | "http" | "other" {
  if (src.startsWith("data:")) return "data";
  if (/^https?:\/\//i.test(src)) return "http";
  return "other";
}

/**
 * Resolve every figure in `doc` to an `ExtractedAsset`. Figures without an
 * `id` (stable ids should be assigned first) fall back to a positional id.
 */
export async function extractAssets(
  doc: CanonicalDocument,
  opts: ExtractAssetsOptions = {},
): Promise<ExtractedAsset[]> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const figures: Figure[] = [];
  const collect = (blocks: CanonicalDocument["body"]): void => {
    for (const b of blocks) {
      if (b.type === "figure") figures.push(b);
      if (b.type === "bulletList" || b.type === "orderedList")
        for (const it of b.items) collect(it.content);
      if (b.type === "blockquote" || b.type === "appendix") collect(b.content);
      if (b.type === "table")
        for (const row of b.rows) for (const cell of row.cells) collect(cell.content);
    }
  };
  collect(doc.body);

  const out: ExtractedAsset[] = [];
  for (let i = 0; i < figures.length; i += 1) {
    const fig = figures[i];
    const id = fig.id ?? `FIG-unknown-${i}`;
    const src = fig.src ?? "";
    const warnings: string[] = [];
    if (!src) {
      out.push({ id, src, bytes: null, colorSpace: "unknown", warnings: ["Figure has no src."] });
      continue;
    }
    const kind = srcKind(src);
    let bytes: Buffer | null = null;
    let ext: string | undefined;
    let mime: string | undefined;

    if (kind === "data") {
      const parsed = parseDataUri(src);
      if (parsed) {
        bytes = parsed.bytes;
        ext = parsed.ext;
        mime = parsed.mime;
      } else {
        warnings.push("Could not parse data URI.");
      }
    } else if (kind === "http") {
      const fetched = await fetchBytes(src, timeoutMs);
      if (fetched) {
        bytes = fetched.bytes;
        ext = fetched.ext;
        mime = fetched.mime;
      } else {
        warnings.push("Failed to fetch image URL.");
      }
    } else {
      const resolved = opts.resolveStorage
        ? await opts.resolveStorage(src)
        : null;
      if (resolved) {
        bytes = resolved;
        ext = extFromUrl(src);
      } else {
        warnings.push("Storage asset could not be resolved.");
      }
    }

    if (!bytes) {
      out.push({ id, src, bytes: null, colorSpace: "unknown", warnings });
      continue;
    }

    const dims = tryImageSize(bytes, ext);
    const colorSpace = detectColorSpace(bytes, ext);
    out.push({
      id,
      src,
      bytes,
      ext,
      mime,
      ...dims,
      colorSpace,
      warnings,
    });
  }
  return out;
}
