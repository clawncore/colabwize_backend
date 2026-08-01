"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlaceholderMarkExtension = void 0;
const core_1 = require("@tiptap/core");
exports.PlaceholderMarkExtension = core_1.Mark.create({
    name: "placeholder",
    addOptions() {
        return {
            HTMLAttributes: {
                class: "template-placeholder-text",
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: "span.template-placeholder-text",
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
exports.default = exports.PlaceholderMarkExtension;
