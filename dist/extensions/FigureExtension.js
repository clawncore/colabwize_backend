"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FigureExtension = void 0;
const core_1 = require("@tiptap/core");
exports.FigureExtension = core_1.Node.create({
    name: "figure",
    group: "block",
    content: "block+",
    defining: true,
    addAttributes() {
        return {
            style: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-style"),
                renderHTML: (attributes) => {
                    if (!attributes.style) {
                        return {};
                    }
                    return {
                        "data-style": attributes.style,
                    };
                },
            },
            span: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-span"),
                renderHTML: (attributes) => {
                    if (!attributes.span) {
                        return {};
                    }
                    return {
                        "data-span": attributes.span,
                    };
                },
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: "div[data-type='figure']",
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-type": "figure" }, 0];
    },
});
exports.default = exports.FigureExtension;
