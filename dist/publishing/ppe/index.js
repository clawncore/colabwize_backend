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
 * Publication Export Engine — public surface.
 *
 * Re-exports the PPE types, the stable-id assigner, the cross-reference indexer,
 * asset extraction + quality checks, the publisher-profile registry, the
 * package builder, and the submission-package output adapter.
 */
__exportStar(require("./types"), exports);
__exportStar(require("./ids"), exports);
__exportStar(require("./xref"), exports);
__exportStar(require("./assets"), exports);
__exportStar(require("./quality"), exports);
__exportStar(require("./profiles"), exports);
__exportStar(require("./serializers/placeholder"), exports);
__exportStar(require("./package"), exports);
__exportStar(require("./adapter"), exports);
