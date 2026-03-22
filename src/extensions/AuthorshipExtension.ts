import { Mark, mergeAttributes } from "@tiptap/core";

export interface AuthorshipOptions {
  HTMLAttributes: Record<string, any>;
}

export const AuthorshipExtension = Mark.create<AuthorshipOptions>({
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
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },
});

export default AuthorshipExtension;
