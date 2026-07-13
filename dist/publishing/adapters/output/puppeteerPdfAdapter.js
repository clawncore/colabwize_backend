"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PuppeteerPdfAdapter = void 0;
/**
 * PDF output adapter using Puppeteer (headless Chromium).
 *
 * Per the approved architecture decision, generation runs in containerized
 * workers (NOT the serverless `nodejs18.x` path where Puppeteer was originally
 * deprecated), so the Chromium binary is available and journal-grade fidelity
 * is preserved. The renderer is injected for testability.
 */
const html_1 = require("../../serializers/html");
const util_1 = require("./util");
const defaultRenderer = {
    async render(html, options) {
        const puppeteer = await import("puppeteer");
        const browser = await puppeteer.default.launch({
            headless: true,
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
        try {
            const page = await browser.newPage();
            await page.setContent(html, { waitUntil: "networkidle0" });
            const pdfOptions = {
                format: "A4",
                printBackground: true,
                margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" },
            };
            const buf = await page.pdf(pdfOptions);
            return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
        }
        finally {
            await browser.close();
        }
    },
};
class PuppeteerPdfAdapter {
    format = "pdf";
    supportedFormats = ["pdf"];
    renderer;
    constructor(opts) {
        this.renderer = opts?.renderer ?? defaultRenderer;
    }
    estimateComplexity(doc) {
        // Large documents render slowly in Chromium.
        const size = doc.body.length + doc.references.length;
        return size > 200 ? "slow" : "fast";
    }
    async generate(doc, ctx) {
        const html = (0, html_1.cdmToHtml)(doc, { fullDocument: true });
        const buffer = await this.renderer.render(html, {
            title: ctx.title ?? doc.metadata.title,
        });
        return (0, util_1.buildResult)("pdf", buffer);
    }
}
exports.PuppeteerPdfAdapter = PuppeteerPdfAdapter;
