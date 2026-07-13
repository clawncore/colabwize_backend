"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CitationNode = void 0;
const core_1 = require("@tiptap/core");
exports.CitationNode = core_1.Node.create({
    name: "citation",
    group: "inline",
    inline: true,
    atom: true,
    addAttributes() {
        return {
            citationId: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-cite"),
                renderHTML: (attributes) => {
                    if (!attributes.citationId) {
                        return {};
                    }
                    return {
                        "data-cite": attributes.citationId,
                    };
                },
            },
            status: {
                default: "unresolved",
                parseHTML: (element) => element.getAttribute("data-status"),
                renderHTML: (attributes) => ({
                    "data-status": attributes.status
                }),
            },
            text: {
                default: "Citation",
                parseHTML: (element) => element.textContent || element.getAttribute("data-text"),
                renderHTML: (attributes) => ({
                    "data-text": attributes.text
                }),
            }
        };
    },
    parseHTML() {
        return [
            {
                tag: "span[data-cite]",
                getAttrs: (node) => {
                    if (typeof node === 'string')
                        return {};
                    const element = node;
                    return {
                        citationId: element.getAttribute("data-cite"),
                        status: element.getAttribute("data-status"),
                        text: element.textContent || element.getAttribute("data-text")
                    };
                }
            },
        ];
    },
    renderHTML({ HTMLAttributes, node }) {
        return [
            "span",
            (0, core_1.mergeAttributes)(HTMLAttributes, {
                class: "citation-pill",
            }),
            node.attrs.text || "Citation"
        ];
    },
});
exports.default = exports.CitationNode;
