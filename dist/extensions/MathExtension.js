"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MathExtension = void 0;
const core_1 = require("@tiptap/core");
exports.MathExtension = core_1.Node.create({
    name: 'math',
    group: 'inline',
    inline: true,
    draggable: true,
    atom: true,
    addAttributes() {
        return {
            latex: {
                default: 'x',
            },
        };
    },
    parseHTML() {
        return [
            {
                tag: 'span[data-type="math"]',
            },
        ];
    },
    renderHTML({ HTMLAttributes }) {
        return ['span', (0, core_1.mergeAttributes)(HTMLAttributes, { 'data-type': 'math' })];
    },
});
exports.default = exports.MathExtension;
