"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeywordsExtension = void 0;
const core_1 = require("@tiptap/core");
exports.KeywordsExtension = core_1.Node.create({
    name: "keywords",
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
        };
    },
    parseHTML() {
        return [
            {
                tag: "div[data-type='keywords']",
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-type": "keywords" }, 0];
    },
});
exports.default = exports.KeywordsExtension;
