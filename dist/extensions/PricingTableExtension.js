"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PricingTableExtension = void 0;
const core_1 = require("@tiptap/core");
exports.PricingTableExtension = core_1.Node.create({
    name: "pricing-table",
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
        };
    },
    parseHTML() {
        return [
            {
                tag: 'div[data-type="pricing-table"]',
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-type": "pricing-table" }, 0];
    },
});
exports.default = exports.PricingTableExtension;
