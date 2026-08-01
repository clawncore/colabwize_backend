"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QuoteBlockExtension = void 0;
const core_1 = require("@tiptap/core");
exports.QuoteBlockExtension = core_1.Node.create({
    name: "quote-block",
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
                tag: 'div[data-type="quote-block"]',
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-type": "quote-block" }, 0];
    },
});
exports.default = exports.QuoteBlockExtension;
