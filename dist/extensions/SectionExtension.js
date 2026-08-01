"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SectionExtension = void 0;
const core_1 = require("@tiptap/core");
exports.SectionExtension = core_1.Node.create({
    name: "section",
    group: "block",
    content: "block+",
    defining: true,
    addAttributes() {
        return {
            title: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-title"),
                renderHTML: (attributes) => {
                    if (!attributes.title) {
                        return {};
                    }
                    return {
                        "data-title": attributes.title,
                    };
                },
            },
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
        };
    },
    parseHTML() {
        return [
            {
                tag: "div[data-type='section']",
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-type": "section" }, 0];
    },
});
exports.default = exports.SectionExtension;
