"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthorBlockExtension = void 0;
const core_1 = require("@tiptap/core");
exports.AuthorBlockExtension = core_1.Node.create({
    name: "author-block",
    group: "block",
    content: "author*",
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
                tag: "div[data-type='author-block']",
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-type": "author-block" }, 0];
    },
});
exports.default = exports.AuthorBlockExtension;
