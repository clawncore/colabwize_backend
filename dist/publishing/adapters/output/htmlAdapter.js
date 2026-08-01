"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HtmlOutputAdapter = void 0;
const html_1 = require("../../serializers/html");
const util_1 = require("./util");
class HtmlOutputAdapter {
    format = "html";
    supportedFormats = ["html"];
    estimateComplexity() {
        return "fast";
    }
    async generate(doc, _ctx) {
        const html = (0, html_1.cdmToHtml)(doc, { fullDocument: true });
        return (0, util_1.buildResult)("html", Buffer.from(html, "utf8"));
    }
}
exports.HtmlOutputAdapter = HtmlOutputAdapter;
