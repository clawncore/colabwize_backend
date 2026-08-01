"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisualElementExtension = void 0;
const core_1 = require("@tiptap/core");
exports.VisualElementExtension = core_1.Node.create({
    name: "visual-element",
    group: "block",
    content: "block*",
    defining: true,
    addAttributes() {
        return {
            element: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-element"),
                renderHTML: (attributes) => {
                    if (!attributes.element) {
                        return {};
                    }
                    return {
                        "data-element": attributes.element,
                    };
                },
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: "div[data-type='visual-element']",
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-type": "visual-element" }, 0];
    },
});
exports.default = exports.VisualElementExtension;
