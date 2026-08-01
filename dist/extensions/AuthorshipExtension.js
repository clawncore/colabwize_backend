"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthorshipExtension = void 0;
const core_1 = require("@tiptap/core");
exports.AuthorshipExtension = core_1.Mark.create({
    name: "authorship",
    addOptions() {
        return {
            HTMLAttributes: {
                class: "authorship-mark",
            },
        };
    },
    addAttributes() {
        return {
            authorId: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-author-id"),
                renderHTML: (attributes) => ({
                    "data-author-id": attributes.authorId,
                }),
            },
            authorName: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-author-name"),
                renderHTML: (attributes) => ({
                    "data-author-name": attributes.authorName,
                }),
            },
            color: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-author-color"),
                renderHTML: (attributes) => ({
                    "data-author-color": attributes.color,
                }),
            },
            timestamp: {
                default: null,
                parseHTML: (element) => element.getAttribute("data-timestamp"),
                renderHTML: (attributes) => ({
                    "data-timestamp": attributes.timestamp,
                }),
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: "span[data-author-id]",
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return [
            "span",
            (0, core_1.mergeAttributes)(this.options.HTMLAttributes, HTMLAttributes),
            0,
        ];
    },
});
exports.default = exports.AuthorshipExtension;
