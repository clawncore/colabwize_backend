"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CoverPageExtension = void 0;
const core_1 = require("@tiptap/core");
exports.CoverPageExtension = core_1.Node.create({
    name: "cover-page",
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
            background: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-background"),
                renderHTML: (attributes) => {
                    if (!attributes.background) {
                        return {};
                    }
                    return {
                        "data-background": attributes.background,
                    };
                },
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: 'div[data-type="cover-page"]',
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-type": "cover-page" }, 0];
    },
});
exports.default = exports.CoverPageExtension;
