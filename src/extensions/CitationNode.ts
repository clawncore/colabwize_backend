import { Node, mergeAttributes } from "@tiptap/core";

export const CitationNode = Node.create({
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
                    if (typeof node === 'string') return {};
                    const element = node as HTMLElement;
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
            mergeAttributes(HTMLAttributes, {
                class: "citation-pill",
            }),
            node.attrs.text || "Citation"
        ];
    },
});

export default CitationNode;
