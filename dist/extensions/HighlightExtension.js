"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HighlightExtension = void 0;
const core_1 = require("@tiptap/core");
exports.HighlightExtension = core_1.Mark.create({
    name: "citation-highlight",
    addAttributes() {
        return {
            color: {
                default: "yellow",
                parseHTML: (element) => element.getAttribute("data-color") || "yellow",
                renderHTML: (attributes) => {
                    return {
                        "data-color": attributes.color,
                        "style": `background-color: ${attributes.color}`,
                    };
                },
            },
            type: {
                default: "originality",
                parseHTML: (element) => element.getAttribute("data-type") || "originality",
                renderHTML: (attributes) => {
                    return {
                        "data-type": attributes.type,
                    };
                },
            },
            similarity: {
                default: 0,
                parseHTML: (element) => element.getAttribute("data-similarity") || 0,
                renderHTML: (attributes) => {
                    return {
                        "data-similarity": attributes.similarity,
                    };
                },
            },
            aiProbability: {
                default: 0,
                parseHTML: (element) => element.getAttribute("data-ai-probability") || 0,
                renderHTML: (attributes) => {
                    return {
                        "data-ai-probability": attributes.aiProbability,
                    };
                },
            },
            message: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-message"),
                renderHTML: (attributes) => {
                    if (!attributes.message)
                        return {};
                    return {
                        "data-message": attributes.message,
                    };
                },
            },
            ruleId: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-rule-id"),
                renderHTML: (attributes) => {
                    if (!attributes.ruleId)
                        return {};
                    return {
                        "data-rule-id": attributes.ruleId,
                    };
                },
            },
            expected: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-expected"),
                renderHTML: (attributes) => {
                    if (!attributes.expected)
                        return {};
                    return {
                        "data-expected": attributes.expected,
                    };
                },
            },
            badgeCode: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-badge-code"),
                renderHTML: (attributes) => {
                    if (!attributes.badgeCode)
                        return {};
                    return {
                        "data-badge-code": attributes.badgeCode,
                    };
                },
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: "mark",
                getAttrs: (node) => {
                    const nodeClass = typeof node === "string"
                        ? node
                        : node.getAttribute("class");
                    return nodeClass?.includes("citation-highlight") ? {} : false;
                },
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return [
            "mark",
            (0, core_1.mergeAttributes)({ class: "citation-highlight" }, HTMLAttributes),
            0,
        ];
    },
});
exports.default = exports.HighlightExtension;
