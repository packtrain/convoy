"use client";

import { Node, mergeAttributes } from "@tiptap/core";

export type ComposerChipKind = "mention" | "command";

export type ComposerChipAttrs = {
  id: string;
  kind: ComposerChipKind;
  label: string;
  href: string;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    composerChip: {
      insertComposerChip: (attrs: ComposerChipAttrs) => ReturnType;
    };
  }
}

export const ComposerChip = Node.create({
  name: "composerChip",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      id: {
        default: "",
      },
      kind: {
        default: "mention",
      },
      label: {
        default: "",
      },
      href: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-composer-chip]",
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-composer-chip": node.attrs.kind,
        "data-chip-id": node.attrs.id,
        "data-chip-href": node.attrs.href,
      }),
      node.attrs.label,
    ];
  },

  renderText({ node }) {
    return node.attrs.label;
  },

  addCommands() {
    return {
      insertComposerChip:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});
