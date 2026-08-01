"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalloutBlockExtension = void 0;
const core_1 = require("@tiptap/core");
exports.CalloutBlockExtension = core_1.Node.create({
    name: "callout-block",
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
            color: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-color"),
                renderHTML: (attributes) => {
                    if (!attributes.color) {
                        return {};
                    }
                    return {
                        "data-color": attributes.color,
                    };
                },
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: 'div[data-type="callout-block"]',
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-type": "callout-block" }, 0];
    },
});
exports.default = exports.CalloutBlockExtension;
