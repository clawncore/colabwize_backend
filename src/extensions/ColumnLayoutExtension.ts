import { Node, mergeAttributes } from "@tiptap/core";

export const ColumnLayoutExtension = Node.create({
  name: "columnLayout",

  group: "block",

  content: "block+",

  defining: true,

  addAttributes() {
    return {
      columns: {
        default: 2,
        parseHTML: (element) =>
          parseInt(element.getAttribute("data-columns") || "2", 10),
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
      mergeAttributes(HTMLAttributes, { class: "columns-wrapper" }),
      0,
    ];
  },
});

export default ColumnLayoutExtension;
