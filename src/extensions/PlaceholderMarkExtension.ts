import { Mark, mergeAttributes } from "@tiptap/core";

export const PlaceholderMarkExtension = Mark.create({
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
            mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
            0,
        ];
    },
});

export default PlaceholderMarkExtension;
