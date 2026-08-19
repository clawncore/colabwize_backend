/**
 * PDF output adapter using Puppeteer (headless Chromium).
 *
 * Per the approved architecture decision, generation runs in containerized
 * workers (NOT the serverless `nodejs18.x` path where Puppeteer was originally
 * deprecated), so the Chromium binary is available and journal-grade fidelity
 * is preserved. The renderer is injected for testability.
 */
import { cdmToHtml } from "../../serializers/html";
import { CanonicalDocument, OutputFormat } from "../../cdm";
import {
  AdapterComplexity,
  GenCtx,
  GenResult,
  OutputAdapter,
} from "../../types";
import { buildResult } from "./util";

export interface PdfRenderer {
  render(html: string, options: { title?: string }): Promise<Buffer>;
}

const defaultRenderer: PdfRenderer = {
  async render(
    html: string,
    options: { title?: string },
  ): Promise<Buffer> {
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });

      const pdfOptions: Parameters<typeof page.pdf>[0] = {
        format: "A4",
        printBackground: true,
        margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
      };

      const buf = await page.pdf(pdfOptions);
      return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    } finally {
      await browser.close();
    }
  },
};

export class PuppeteerPdfAdapter implements OutputAdapter {
  format: OutputFormat = "pdf";
  supportedFormats: OutputFormat[] = ["pdf"];
  private renderer: PdfRenderer;

  constructor(opts?: { renderer?: PdfRenderer }) {
    this.renderer = opts?.renderer ?? defaultRenderer;
  }

  estimateComplexity(doc: CanonicalDocument): AdapterComplexity {
    // Large documents render slowly in Chromium.
    const size = doc.body.length + doc.references.length;
    return size > 200 ? "slow" : "fast";
  }

  async generate(doc: CanonicalDocument, ctx: GenCtx): Promise<GenResult> {
    const html = cdmToHtml(doc, { fullDocument: true });
    const buffer = await this.renderer.render(html, {
      title: ctx.title ?? doc.metadata.title,
    });
    return buildResult("pdf", buffer);
  }
}
