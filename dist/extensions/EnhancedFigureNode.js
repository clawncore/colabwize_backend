"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnhancedFigureNode = void 0;
const core_1 = require("@tiptap/core");
exports.EnhancedFigureNode = core_1.Node.create({
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
        return ["figure", (0, core_1.mergeAttributes)(HTMLAttributes, { class: "figure-node" }), 0];
    },
});
exports.default = exports.EnhancedFigureNode;
