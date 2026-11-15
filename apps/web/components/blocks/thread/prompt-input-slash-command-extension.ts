"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import type { SlashCommandNodeAttrs } from "@/lib/slash-commands/composer";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    slashCommand: {
      insertSlashCommand: (attrs: SlashCommandNodeAttrs) => ReturnType;
    };
  }
}

export const PromptInputSlashCommand = Node.create({
  name: "slashCommand",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,

  addAttributes() {
    return {
      type: {
        default: "slash-command",
      },
      id: {
        default: "",
      },
      scope: {
        default: "organization",
      },
      key: {
        default: "",
      },
      canonicalKey: {
        default: "",
      },
      displayLabel: {
        default: "",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-slash-command]",
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-slash-command": node.attrs.canonicalKey,
        "data-slash-command-id": node.attrs.id,
        // Skill pills take their own accent (docs/specs/skills.md#trigger-and-appearance).
        "data-slash-command-kind": node.attrs.type === "skill" ? "skill" : "command",
      }),
      ["span", { "data-slash-command-label": "true" }, node.attrs.displayLabel],
    ];
  },

  renderText({ node }) {
    return node.attrs.displayLabel;
  },

  addCommands() {
    return {
      insertSlashCommand:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});
