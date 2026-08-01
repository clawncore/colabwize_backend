"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BibliographyEntry = void 0;
const core_1 = require("@tiptap/core");
exports.BibliographyEntry = core_1.Node.create({
    name: "bibliographyEntry",
    group: "block",
    content: "inline*",
    addAttributes() {
        return {
            citationId: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-citation-id"),
                renderHTML: (attributes) => ({
                    "data-citation-id": attributes.citationId,
                }),
            },
            url: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-url"),
                renderHTML: (attributes) => ({
                    "data-url": attributes.url,
                }),
            },
            doi: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-doi"),
                renderHTML: (attributes) => ({
                    "data-doi": attributes.doi,
                }),
            },
            refText: {
                default: "",
                parseHTML: (element) => element.getAttribute("data-ref-text"),
                renderHTML: (attributes) => ({
                    "data-ref-text": attributes.refText,
                }),
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: "div[data-bibliography-entry]",
            },
        ];
    },
    renderHTML({ HTMLAttributes, node }) {
        return [
            "div",
            (0, core_1.mergeAttributes)(HTMLAttributes, {
                "data-bibliography-entry": true,
                class: "bibliography-entry",
                id: `bib-${node.attrs.citationId || ""}`,
            }),
            0,
        ];
    },
});
exports.default = exports.BibliographyEntry;
