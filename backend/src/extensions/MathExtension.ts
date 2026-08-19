import { Node, mergeAttributes } from '@tiptap/core';

export const MathExtension = Node.create({
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
        return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'math' })];
    },
});

export default MathExtension;
