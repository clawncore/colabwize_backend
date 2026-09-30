import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import os from "os";
import logger from "../monitoring/logger";

const execAsync = promisify(exec);

// Dynamic Pandoc path resolution
const getPandocPath = async () => {
  // 1. Check environment variable
  if (process.env.PANDOC_PATH) return process.env.PANDOC_PATH;

  // 2. Check project-relative bin directory
  const relativePath = path.join(process.cwd(), "bin", "bin", "pandoc");
  try {
    await fs.access(relativePath);
    return relativePath;
  } catch {
    // 3. Fallback to system path
    return "pandoc";
  }
};

export interface PandocExportOptions {
  format: "pdf" | "docx" | "txt" | "latex" | "rtf" | "html";
  citationStyle?: string;
  metadata?: any;
  citations?: any[];
  htmlContent?: string;
}

export class PandocExportService {
  // Image localization limits (anti-abuse + convert-time bounds)
  private static readonly MAX_REMOTE_IMAGES = 25;
  private static readonly MAX_IMAGE_BYTES = 8 * 1024 * 1024;
  private static readonly IMAGE_FETCH_TIMEOUT_MS = 10_000;

  /**
   * Download remote (<img src="http...">) and decode embedded
   * (<img src="data:...">) images into tempDir, rewriting src to the local
   * filename. Pandoc's PDF engine (LaTeX) cannot fetch remote URLs, so
   * without this step linked images (and tables containing them) export
   * as blanks. Failures degrade gracefully: the original src is kept.
   */
  private static async localizeImages(
    html: string,
    tempDir: string,
  ): Promise<string> {
    const imgTagRegex = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
    const matches: { full: string; src: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = imgTagRegex.exec(html)) !== null && matches.length < this.MAX_REMOTE_IMAGES) {
      matches.push({ full: m[0], src: m[2] });
    }
    if (matches.length === 0) return html;

    let counter = 0;
    const replacements = new Map<string, string>();

    for (const { src } of matches) {
      if (replacements.has(src)) continue;
      try {
        let buffer: Buffer | null = null;
        let ext = "png";

        if (/^https?:\/\//i.test(src)) {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            this.IMAGE_FETCH_TIMEOUT_MS,
          );
          try {
            const res = await fetch(src, {
              signal: controller.signal,
              headers: { "User-Agent": "ColabWize-Export/1.0" },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const contentType = res.headers.get("content-type") || "";
            const mt = contentType.match(/image\/(jpeg|jpg|png|gif|webp|svg\+xml|svg|bmp)/i);
            if (mt) {
              ext = mt[1].toLowerCase().replace("jpeg", "jpg").replace("svg+xml", "svg");
            }
            const ab = await res.arrayBuffer();
            if (ab.byteLength === 0 || ab.byteLength > this.MAX_IMAGE_BYTES) {
              throw new Error(`Bad image size: ${ab.byteLength}`);
            }
            buffer = Buffer.from(ab);
          } finally {
            clearTimeout(timeout);
          }
        } else if (/^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml|svg);base64,/i.test(src)) {
          const dm = src.match(/^data:image\/(png|jpe?g|gif|webp|bmp|svg\+xml|svg);base64,(.*)$/is);
          if (!dm) continue;
          ext = dm[1].toLowerCase().replace("jpeg", "jpg").replace("svg+xml", "svg");
          buffer = Buffer.from(dm[2], "base64");
          if (buffer.length === 0 || buffer.length > this.MAX_IMAGE_BYTES) {
            logger.warn("[Pandoc] Skipping oversized embedded image", { bytes: buffer.length });
            continue;
          }
        } else {
          // blob:, relative, or already-local paths — nothing to resolve server-side
          continue;
        }

        if (!buffer) continue;
        const filename = `img-${counter++}.${ext}`;
        await fs.writeFile(path.join(tempDir, filename), buffer);
        replacements.set(src, filename);
      } catch (err: any) {
        logger.warn("[Pandoc] Could not localize export image, keeping remote src", {
          src: src.slice(0, 120),
          error: err?.message,
        });
      }
    }

    if (replacements.size === 0) return html;
    return html.replace(imgTagRegex, (full, _q, src: string) => {
      const local = replacements.get(src);
      return local ? full.replace(src, local) : full;
    });
  }

  /**
   * Export project using Pandoc (HTML source only)
   */
  static async exportProject(
    project: any,
    options: PandocExportOptions
  ): Promise<{ buffer: Buffer; fileSize: number }> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "colabwize-export-"));
    const htmlContent = options.htmlContent || "";

    try {
      const extension = options.format === 'pdf' ? 'pdf' : options.format;
      const outputPath = path.join(tempDir, `output.${extension}`);

      logger.info(`[Pandoc] Exporting via HTML direct path to ${options.format}`);

      // PDF goes through headless Chromium (high fidelity: real CSS tables,
      // images, page headers). Pandoc has no PDF engine installed on Render,
      // and its LaTeX engine cannot fetch remote image URLs anyway.
      if (options.format === "pdf") {
        try {
          return await this.renderPdfViaPuppeteer(htmlContent, tempDir);
        } catch (pdfError: any) {
          // Fall back to Pandoc rather than failing the export outright
          // (e.g. local dev without a Chromium binary).
          logger.warn("[Pandoc] Puppeteer PDF failed, falling back to Pandoc", {
            error: pdfError?.message,
          });
        }
      }

      // Localize images so linked/embedded pictures survive conversion.
      const localizedHtml = await this.localizeImages(htmlContent, tempDir);
      const wrappedHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${localizedHtml}</body></html>`;
      const htmlPath = path.join(tempDir, "input.html");
      await fs.writeFile(htmlPath, wrappedHtml);

      const pandocPath = await getPandocPath();

      // For PDF, we might need to specify a pdf-engine.
      // We'll let Pandoc try its default first, but we can't use Puppeteer anymore.
      // --resource-path lets Pandoc resolve the localized ./img-N.ext files.
      const pandocCmd = `"${pandocPath}" "${htmlPath}" -f html -s --resource-path="${tempDir}" -o "${outputPath}"`;

      logger.info(`[Pandoc] Running command: ${pandocCmd}`);
      
      await execAsync(pandocCmd);
      const buffer = await fs.readFile(outputPath);
      return { buffer, fileSize: buffer.length };
    } catch (error: any) {
      logger.error("Pandoc export failed", { error: error.message, stack: error.stack });
      throw new Error(`Failed to export using Pandoc: ${error.message}. (Ensure a PDF engine like wkhtmltopdf or lualatex is installed for PDF export)`);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * High-fidelity PDF rendering using Puppeteer (headless Chromium).
   * Images are embedded as data URLs (no network dependency at render
   * time) and print CSS keeps tables/images intact across pages.
   */
  private static async renderPdfViaPuppeteer(
    htmlContent: string,
    tempDir: string,
  ): Promise<{ buffer: Buffer; fileSize: number }> {
    const localizedHtml = await this.localizeImages(htmlContent, tempDir);
    const withDataUrls = await this.embedLocalImagesAsDataUrls(
      localizedHtml,
      tempDir,
    );
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
      body { font-family: Georgia, 'Times New Roman', serif; font-size: 12pt; line-height: 1.6; color: #111; }
      img { max-width: 100%; height: auto; }
      table { border-collapse: collapse; width: 100%; margin: 1em 0; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      th, td { border: 1px solid #999; padding: 6px 10px; text-align: left; }
      th { background: #f2f2f2; }
      pre, blockquote { break-inside: avoid; }
      a { color: #1a56db; }
    </style></head><body>${withDataUrls}</body></html>`;

    const puppeteer = await import("puppeteer");
    const { ExportService } = await import("./exportService.js");
    const browser = await (ExportService as any).launchBrowser(puppeteer.default);

    try {
      const page = await browser.newPage();
      await page.emulateMediaType("print");
      await page.setContent(fullHtml, { waitUntil: "networkidle0" });
      const buffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
      });
      const out = Buffer.from(buffer);
      return { buffer: out, fileSize: out.length };
    } finally {
      await browser.close();
    }
  }

  /**
   * Rewrite localized ./img-N.ext sources to data URLs so Chromium renders
   * them with zero filesystem/network dependence.
   */
  private static async embedLocalImagesAsDataUrls(
    html: string,
    tempDir: string,
  ): Promise<string> {
    const imgTagRegex = /<img\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1[^>]*>/gi;
    const urlToDataUrl = new Map<string, string>();
    const mimeByExt: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
      svg: "image/svg+xml",
    };

    let m: RegExpExecArray | null;
    const pending: string[] = [];
    while ((m = imgTagRegex.exec(html)) !== null) {
      const src = m[2];
      if (/^\.\/img-\d+\.\w+$|^img-\d+\.\w+$/.test(src) && !pending.includes(src)) {
        pending.push(src);
      }
    }

    for (const src of pending) {
      try {
        const filename = src.replace(/^\.\//, "");
        const data = await fs.readFile(path.join(tempDir, filename));
        const ext = (filename.split(".").pop() || "png").toLowerCase();
        urlToDataUrl.set(
          src,
          `data:${mimeByExt[ext] || "image/png"};base64,${data.toString("base64")}`,
        );
      } catch {
        // Keep the local src; Chromium resolves it relative to nothing,
        // so it will be blank — same as before, no worse.
      }
    }

    if (urlToDataUrl.size === 0) return html;
    return html.replace(imgTagRegex, (full, _q, src: string) => {
      const dataUrl = urlToDataUrl.get(src);
      return dataUrl ? full.replace(src, dataUrl) : full;
    });
  }
}
