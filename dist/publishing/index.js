"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Publishing Platform — public surface.
 *
 * Re-exports the Canonical Document Model (Phase 1), the Publishing Engine +
 * output adapters (Phase 2), the Export Job System (Phase 3), templates +
 * validation (Phase 4), and destinations (Phase 5).
 *
 * NOTE: `export *` from the jobs module is scoped to avoid leaking its many
 * internal types into the top-level namespace unintentionally.
 */
__exportStar(require("./cdm"), exports);
__exportStar(require("./types"), exports);
__exportStar(require("./engine"), exports);
__exportStar(require("./serializers/html"), exports);
__exportStar(require("./serializers/markdown"), exports);
__exportStar(require("./serializers/text"), exports);
__exportStar(require("./ppe"), exports);
__exportStar(require("./adapters/output/pandocAdapter"), exports);
__exportStar(require("./adapters/output/puppeteerPdfAdapter"), exports);
__exportStar(require("./adapters/output/htmlAdapter"), exports);
__exportStar(require("./adapters/output/markdownAdapter"), exports);
__exportStar(require("./adapters/output/textAdapter"), exports);
__exportStar(require("./jobs"), exports);
__exportStar(require("./destinations"), exports);
