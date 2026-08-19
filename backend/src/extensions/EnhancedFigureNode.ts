import { Node, mergeAttributes } from "@tiptap/core";

export const EnhancedFigureNode = Node.create({
    name: "figure",

    group: "block",

    content: "", // No nested content, caption is in attributes

    atom: true, // Treated as a single unit

    draggable: true,

    addAttributes() {
        return {
            src: {
                default: null,
            },
            alt: {
                default: "",
            },
            width: {
                default: null,
            },
            height: {
                default: null,
            },
            rotate: {
                default: 0,
            },
            align: {
                default: "center",
            },
            figureNumber: {
                default: null,
            },
            caption: {
                default: "",
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: "figure",
            },
        ];
    },

    renderHTML({ HTMLAttributes }) {
        return ["figure", mergeAttributes(HTMLAttributes, { class: "figure-node" }), 0];
    },
});

export default EnhancedFigureNode;
