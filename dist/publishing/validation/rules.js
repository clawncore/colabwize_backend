"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_VALIDATION_RULES = exports.emptyDocumentRule = exports.missingTitleRule = exports.orphanAssetRule = exports.emptySectionRule = exports.orphanReferenceRule = exports.danglingCitationRule = exports.unresolvedCitationRule = void 0;
const walk_1 = require("./walk");
/**
 * Default validation rules. Each is independently testable and composable; the
 * engine runs them all and aggregates the findings.
 *
 * Coverage maps to the Phase 4 content checks: broken references, orphan
 * references, empty sections, orphan/missing assets, plus a few high-signal
 * guards (unresolved citations, missing title, empty document).
 */
exports.unresolvedCitationRule = {
    code: "unresolved-citation",
    description: "Flags inline citations that are not yet resolved to a reference.",
    validate(doc) {
        const findings = [];
        for (const c of (0, walk_1.collectCitations)(doc)) {
            if (c.status && c.status !== "resolved") {
                findings.push({
                    severity: "error",
                    code: "unresolved-citation",
                    message: `Citation${c.citationId ? ` "${c.citationId}"` : ""} is not resolved to a reference.`,
                    locator: { blockIndex: c.blockIndex, nodeType: "citation", citationId: c.citationId },
                });
            }
        }
        return findings;
    },
};
exports.danglingCitationRule = {
    code: "dangling-citation",
    description: "Flags inline citations whose id is absent from the reference list.",
    validate(doc) {
        const refs = new Set((0, walk_1.referenceIds)(doc));
        const findings = [];
        for (const c of (0, walk_1.collectCitations)(doc)) {
            if (c.citationId && !refs.has(c.citationId)) {
                findings.push({
                    severity: "error",
                    code: "dangling-citation",
                    message: `Citation "${c.citationId}" is not present in the reference list.`,
                    locator: { blockIndex: c.blockIndex, nodeType: "citation", citationId: c.citationId },
                });
            }
        }
        return findings;
    },
};
exports.orphanReferenceRule = {
    code: "orphan-reference",
    description: "Flags references that are never cited in the body.",
    validate(doc) {
        const cited = new Set((0, walk_1.collectCitations)(doc)
            .map((c) => c.citationId)
            .filter((id) => typeof id === "string"));
        const findings = [];
        for (const ref of doc.references) {
            if (!cited.has(ref.id)) {
                findings.push({
                    severity: "warning",
                    code: "orphan-reference",
                    message: `Reference "${ref.id}" is not cited anywhere in the document.`,
                    locator: { citationId: ref.id },
                });
            }
        }
        return findings;
    },
};
exports.emptySectionRule = {
    code: "empty-section",
    description: "Flags headings with no body content before the next heading.",
    validate(doc) {
        const headings = (0, walk_1.headingIndices)(doc);
        const findings = [];
        for (let i = 0; i < headings.length; i++) {
            const idx = headings[i];
            const nextIdx = i + 1 < headings.length ? headings[i + 1] : doc.body.length;
            // A heading is "empty" if the only blocks until the next heading are
            // themselves headings or non-content blocks (e.g. a page break).
            const hasContent = doc.body
                .slice(idx + 1, nextIdx)
                .some((b) => b.type === "paragraph" || b.type === "bulletList" || b.type === "orderedList" || b.type === "table" || b.type === "figure" || b.type === "codeBlock" || b.type === "blockquote");
            if (!hasContent) {
                findings.push({
                    severity: "warning",
                    code: "empty-section",
                    message: `Section starting at block ${idx} has no body content.`,
                    locator: { blockIndex: idx, nodeType: "heading" },
                });
            }
        }
        return findings;
    },
};
exports.orphanAssetRule = {
    code: "orphan-asset",
    description: "Flags assets never used, and figures referencing missing assets.",
    validate(doc) {
        const defined = new Set((0, walk_1.assetIdsDefined)(doc));
        const used = new Set((0, walk_1.assetIdsUsed)(doc));
        const findings = [];
        for (const id of defined) {
            if (!used.has(id)) {
                findings.push({
                    severity: "warning",
                    code: "orphan-asset",
                    message: `Asset "${id}" is defined but never used in the document.`,
                    locator: { citationId: id },
                });
            }
        }
        for (const id of used) {
            if (!defined.has(id)) {
                findings.push({
                    severity: "warning",
                    code: "missing-asset",
                    message: `A figure references asset "${id}" which is not defined.`,
                    locator: { citationId: id },
                });
            }
        }
        return findings;
    },
};
exports.missingTitleRule = {
    code: "missing-title",
    description: "Warns when the document has no title metadata.",
    validate(doc) {
        if (!doc.metadata?.title || doc.metadata.title.trim().length === 0) {
            return [
                {
                    severity: "warning",
                    code: "missing-title",
                    message: "The document has no title.",
                },
            ];
        }
        return [];
    },
};
exports.emptyDocumentRule = {
    code: "empty-document",
    description: "Blocks publishing an empty document.",
    validate(doc) {
        if (!doc.body || doc.body.length === 0) {
            return [
                {
                    severity: "error",
                    code: "empty-document",
                    message: "The document is empty and cannot be published.",
                },
            ];
        }
        return [];
    },
};
/** All default rules, in evaluation order. */
exports.DEFAULT_VALIDATION_RULES = [
    exports.emptyDocumentRule,
    exports.unresolvedCitationRule,
    exports.danglingCitationRule,
    exports.orphanReferenceRule,
    exports.emptySectionRule,
    exports.orphanAssetRule,
    exports.missingTitleRule,
];
