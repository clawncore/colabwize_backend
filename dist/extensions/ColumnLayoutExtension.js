"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ColumnLayoutExtension = void 0;
const core_1 = require("@tiptap/core");
exports.ColumnLayoutExtension = core_1.Node.create({
    name: "columnLayout",
    group: "block",
    content: "block+",
    defining: true,
    addAttributes() {
        return {
            columns: {
                default: 2,
                parseHTML: (element) => parseInt(element.getAttribute("data-columns") || "2", 10),
                renderHTML: (attributes) => ({
                    "data-columns": attributes.columns,
                }),
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: 'div[class="columns-wrapper"]',
            },
            {
                tag: "div[data-columns]",
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return [
            "div",
            (0, core_1.mergeAttributes)(HTMLAttributes, { class: "columns-wrapper" }),
            0,
        ];
    },
});
exports.default = exports.ColumnLayoutExtension;
