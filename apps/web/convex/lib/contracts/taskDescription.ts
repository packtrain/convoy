import { getSchema } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import StarterKit from "@tiptap/starter-kit";
import { MarkdownParser, defaultMarkdownParser, type ParseSpec } from "@tiptap/pm/markdown";
import type { Schema as ProseMirrorSchema } from "@tiptap/pm/model";
import { is } from "@/lib/type-guards";

// Server-side normalization deliberately uses stable `prosemirror-markdown`
// parsing instead of Tiptap's markdown beta surface to reduce backend churn.
const TASK_DESCRIPTION_MARKDOWN_SCHEMA = getSchema([
  StarterKit.configure({
    // Keep this aligned with the task description editor's StarterKit baseline:
    // apps/web/components/blocks/tasks/task-description-editor.tsx
    horizontalRule: false,
    dropcursor: false,
  }),
  Image,
]);

const MARKDOWN_TOKEN_NAME_MAP: Readonly<Record<string, string>> = {
  list_item: "listItem",
  bullet_list: "bulletList",
  ordered_list: "orderedList",
  code_block: "codeBlock",
  horizontal_rule: "horizontalRule",
  hard_break: "hardBreak",
  em: "italic",
  strong: "bold",
};

function mapMarkdownTokenName(name: string): string {
  return MARKDOWN_TOKEN_NAME_MAP[name] ?? name;
}

function mapMarkdownParseSpec(spec: ParseSpec): ParseSpec {
  return {
    ...spec,
    ...(typeof spec.block === "string" && { block: mapMarkdownTokenName(spec.block) }),
    ...(typeof spec.node === "string" && { node: mapMarkdownTokenName(spec.node) }),
    ...(typeof spec.mark === "string" && { mark: mapMarkdownTokenName(spec.mark) }),
  };
}

function isMarkdownParseSpecSupportedBySchema(schema: ProseMirrorSchema, spec: ParseSpec): boolean {
  if (typeof spec.block === "string" && schema.nodes[spec.block] === undefined) {
    return false;
  }
  if (typeof spec.node === "string" && schema.nodes[spec.node] === undefined) {
    return false;
  }
  if (typeof spec.mark === "string" && schema.marks[spec.mark] === undefined) {
    return false;
  }
  return true;
}

function buildTaskDescriptionMarkdownTokens(): Record<string, ParseSpec> {
  const entries = Object.entries(defaultMarkdownParser.tokens).flatMap(([tokenName, tokenSpec]) => {
    const mapped = mapMarkdownParseSpec(tokenSpec);
    if (!isMarkdownParseSpecSupportedBySchema(TASK_DESCRIPTION_MARKDOWN_SCHEMA, mapped)) {
      return [];
    }
    return [[tokenName, mapped] as const];
  });

  return Object.fromEntries(entries);
}

const TASK_DESCRIPTION_MARKDOWN_PARSER = new MarkdownParser(
  TASK_DESCRIPTION_MARKDOWN_SCHEMA,
  defaultMarkdownParser.tokenizer,
  buildTaskDescriptionMarkdownTokens()
);

type ProseMirrorDocJson = {
  type: "doc";
  content?: unknown;
};

function isProseMirrorDocJson(value: unknown): value is ProseMirrorDocJson {
  if (!is.record(value) || value.type !== "doc") {
    return false;
  }
  if (value.content === undefined) {
    return true;
  }
  return Array.isArray(value.content);
}

function createPlainTextTaskDescriptionDoc(text: string) {
  return {
    type: "doc" as const,
    content: [
      text.length > 0
        ? {
            type: "paragraph" as const,
            content: [{ type: "text" as const, text }],
          }
        : { type: "paragraph" as const },
    ],
  };
}

function normalizeTaskDescriptionString(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length > 0) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isProseMirrorDocJson(parsed)) {
        return value;
      }
    } catch {
      // Not JSON; treat as markdown/plain text
    }
  }

  try {
    const parsedDoc = TASK_DESCRIPTION_MARKDOWN_PARSER.parse(value).toJSON();
    return JSON.stringify(parsedDoc);
  } catch (error) {
    console.warn("[mcp] Failed to parse markdown task description; falling back to plain-text doc.", error);
    return JSON.stringify(createPlainTextTaskDescriptionDoc(value));
  }
}

export function normalizeTaskDescription(value: string): string;
export function normalizeTaskDescription(value: string | undefined): string | undefined;
export function normalizeTaskDescription(value: string | null): string | null;
export function normalizeTaskDescription(value: string | null | undefined): string | null | undefined;
export function normalizeTaskDescription(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  return normalizeTaskDescriptionString(value);
}
