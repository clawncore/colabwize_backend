import { Node, mergeAttributes } from "@tiptap/core";

export const BibliographyEntry = Node.create({
  name: "bibliographyEntry",

  group: "block",
  content: "inline*",

  addAttributes() {
    return {
      citationId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-citation-id"),
        renderHTML: (attributes) => ({
          "data-citation-id": attributes.citationId,
        }),
      },
      url: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-url"),
        renderHTML: (attributes) => ({
          "data-url": attributes.url,
        }),
      },
      doi: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-doi"),
        renderHTML: (attributes) => ({
          "data-doi": attributes.doi,
        }),
      },
      refText: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-ref-text"),
        renderHTML: (attributes) => ({
          "data-ref-text": attributes.refText,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-bibliography-entry]",
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-bibliography-entry": true,
        class: "bibliography-entry",
        id: `bib-${node.attrs.citationId || ""}`,
      }),
      0,
    ];
  },
});

export default BibliographyEntry;
