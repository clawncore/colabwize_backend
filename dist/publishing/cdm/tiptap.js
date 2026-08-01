"use strict";
/**
 * Structural types for TipTap / ProseMirror JSON documents.
 *
 * These are intentionally minimal (input contract only) — the importer does not
 * depend on the `@tiptap/*` runtime, keeping the CDM module pure and unit-testable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTiptapDoc = isTiptapDoc;
function isTiptapDoc(value) {
    return (typeof value === "object" &&
        value !== null &&
        value.type === "doc" &&
        Array.isArray(value.content));
}
