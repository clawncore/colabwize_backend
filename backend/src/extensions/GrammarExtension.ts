import { Mark, mergeAttributes } from "@tiptap/core";

export const GrammarExtension = Mark.create({
    name: "grammar-error",

    addAttributes() {
        return {
            suggestion: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-suggestion"),
                renderHTML: (attributes) => {
                    if (!attributes.suggestion) return {};
                    return { "data-suggestion": attributes.suggestion };
                },
            },
            explanation: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-explanation"),
                renderHTML: (attributes) => {
                    if (!attributes.explanation) return {};
                    return { "data-explanation": attributes.explanation };
                },
            },
            type: {
                default: "grammar",
                parseHTML: (element) => element.getAttribute("data-type"),
                renderHTML: (attributes) => {
                    if (!attributes.type) return {};
                    return {
                        "data-type": attributes.type,
                        "class": `grammar-error grammar-error-${attributes.type}`
                    };
                },
            },
            original: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-original"),
                renderHTML: (attributes) => {
                    if (!attributes.original) return {};
                    return { "data-original": attributes.original };
                },
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: "span",
                getAttrs: (node) => {
                    const element = node as HTMLElement;
                    return element.classList.contains("grammar-error") && null;
                },
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ["span", mergeAttributes(HTMLAttributes, { class: "grammar-error" }), 0];
    },
});

export default GrammarExtension;
