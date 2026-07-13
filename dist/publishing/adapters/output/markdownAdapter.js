"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarkdownOutputAdapter = void 0;
const markdown_1 = require("../../serializers/markdown");
const util_1 = require("./util");
class MarkdownOutputAdapter {
    format = "md";
    supportedFormats = ["md"];
    estimateComplexity() {
        return "fast";
    }
    async generate(doc, _ctx) {
        const md = (0, markdown_1.cdmToMarkdown)(doc);
        return (0, util_1.buildResult)("md", Buffer.from(md, "utf8"));
    }
}
exports.MarkdownOutputAdapter = MarkdownOutputAdapter;
