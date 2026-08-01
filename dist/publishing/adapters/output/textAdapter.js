"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlainTextAdapter = void 0;
const text_1 = require("../../serializers/text");
const util_1 = require("./util");
class PlainTextAdapter {
    format = "txt";
    supportedFormats = ["txt"];
    estimateComplexity() {
        return "fast";
    }
    async generate(doc, _ctx) {
        const text = (0, text_1.cdmToPlainText)(doc);
        return (0, util_1.buildResult)("txt", Buffer.from(text, "utf8"));
    }
}
exports.PlainTextAdapter = PlainTextAdapter;
