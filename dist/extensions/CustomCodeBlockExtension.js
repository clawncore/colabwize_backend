"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CustomCodeBlockExtension = void 0;
const core_1 = require("@tiptap/core");
exports.CustomCodeBlockExtension = core_1.Node.create({
    name: "code-block",
    group: "block",
    content: "text*",
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
            language: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-language"),
                renderHTML: (attributes) => {
                    if (!attributes.language) {
                        return {};
                    }
                    return {
                        "data-language": attributes.language,
                    };
                },
            },
            "border-color": {
                default: null,
                parseHTML: (element) => element.getAttribute("data-border-color"),
                renderHTML: (attributes) => {
                    if (!attributes["border-color"]) {
                        return {};
                    }
                    return {
                        "data-border-color": attributes["border-color"],
                    };
                },
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: "div[data-type='code-block']",
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-type": "code-block" }, 0];
    },
});
exports.default = exports.CustomCodeBlockExtension;
