"use client";

import { Node, mergeAttributes } from "@tiptap/core";

/** Composer @-file-mention pill (OS-1144); serializes as inline `@path` text. */
export interface FileMentionNodeAttrs {
  type: "file-mention";
  path: string;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fileMention: {
      insertFileMention: (attrs: FileMentionNodeAttrs) => ReturnType;
    };
  }
}

export const PromptInputFileMention = Node.create({
  name: "fileMention",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      type: {
        default: "file-mention",
      },
      path: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-file-mention]",
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-file-mention": node.attrs.path,
      }),
      ["span", { "data-file-mention-label": "true" }, `@${node.attrs.path}`],
    ];
  },

  renderText({ node }) {
    return `@${node.attrs.path}`;
  },

  addCommands() {
    return {
      insertFileMention:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});
