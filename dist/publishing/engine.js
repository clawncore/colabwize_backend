"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishingEngine = exports.PublishingEngine = void 0;
exports.generateDocument = generateDocument;
const pandocAdapter_1 = require("./adapters/output/pandocAdapter");
const puppeteerPdfAdapter_1 = require("./adapters/output/puppeteerPdfAdapter");
const htmlAdapter_1 = require("./adapters/output/htmlAdapter");
const markdownAdapter_1 = require("./adapters/output/markdownAdapter");
const textAdapter_1 = require("./adapters/output/textAdapter");
const adapter_1 = require("./ppe/adapter");
class PublishingEngine {
    adapters = new Map();
    constructor(adapters) {
        for (const a of adapters ?? PublishingEngine.defaultAdapters()) {
            this.register(a);
        }
    }
    static defaultAdapters() {
        return [
            new pandocAdapter_1.PandocOutputAdapter({
                format: "docx",
                formats: ["docx", "latex", "rtf", "epub"],
            }),
            new puppeteerPdfAdapter_1.PuppeteerPdfAdapter(),
            new htmlAdapter_1.HtmlOutputAdapter(),
            new markdownAdapter_1.MarkdownOutputAdapter(),
            new textAdapter_1.PlainTextAdapter(),
        ];
    }
    register(adapter) {
        for (const f of adapter.supportedFormats) {
            this.adapters.set(f, adapter);
        }
    }
    getAdapter(format) {
        return this.adapters.get(format);
    }
    async generate(doc, opts) {
        // Lazily register the submission adapter (avoids a module-load cycle with
        // engine.ts, since the adapter references the shared engine instance).
        if (opts.format === "submission" && !this.adapters.has("submission")) {
            this.register(new adapter_1.SubmissionPackageAdapter());
        }
        const adapter = this.adapters.get(opts.format);
        if (!adapter) {
            throw new Error(`No output adapter registered for format "${opts.format}".`);
        }
        const ctx = {
            format: opts.format,
            cslStyle: opts.cslStyle ?? doc.settings.cslStyle,
            templateId: opts.templateId,
            title: doc.metadata.title,
            enableCiteproc: opts.enableCiteproc,
            placeholderLabels: opts.placeholderLabels,
            ppe: opts.ppe,
        };
        return adapter.generate(doc, ctx);
    }
}
exports.PublishingEngine = PublishingEngine;
/** Shared engine instance with the default adapter registry. */
exports.publishingEngine = new PublishingEngine();
function generateDocument(doc, opts) {
    return exports.publishingEngine.generate(doc, opts);
}
