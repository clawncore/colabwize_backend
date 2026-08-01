"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListExtension = void 0;
const core_1 = require("@tiptap/core");
exports.ListExtension = core_1.Node.create({
    name: "list",
    group: "block",
    content: "listItem+",
    defining: true,
    addAttributes() {
        return {
            listType: {
                default: "bullet",
                parseHTML: (element) => element.getAttribute("data-list-type"),
                renderHTML: (attributes) => {
                    if (!attributes.listType) {
                        return {};
                    }
                    return {
                        "data-list-type": attributes.listType,
                    };
                },
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: "div[data-type='list']",
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ["div", { ...HTMLAttributes, "data-type": "list" }, 0];
    },
});
exports.default = exports.ListExtension;
