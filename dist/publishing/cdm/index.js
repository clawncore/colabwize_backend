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
exports.cdmToTiptap = exports.tiptapToCdm = void 0;
/**
 * Canonical Document Model — public surface.
 *
 * Phase 1 of the Publishing Platform (see docs/PUBLISHING_PLATFORM_ARCHITECTURE_PLAN.md).
 * Later phases (Engine, Adapters, Job System) build on these pure, dependency-free
 * primitives.
 */
__exportStar(require("./types"), exports);
__exportStar(require("./tiptap"), exports);
__exportStar(require("./schema"), exports);
var tiptapImporter_1 = require("./tiptapImporter");
Object.defineProperty(exports, "tiptapToCdm", { enumerable: true, get: function () { return tiptapImporter_1.tiptapToCdm; } });
var cdmExporter_1 = require("./cdmExporter");
Object.defineProperty(exports, "cdmToTiptap", { enumerable: true, get: function () { return cdmExporter_1.cdmToTiptap; } });
