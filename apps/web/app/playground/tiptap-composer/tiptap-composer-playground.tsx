"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Placeholder } from "@tiptap/extension-placeholder";
import { StarterKit } from "@tiptap/starter-kit";
import { AtSign, Sparkles, TerminalSquare } from "lucide-react";

import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";

import {
  ComposerChip,
  type ComposerChipAttrs,
} from "./composer-chip-extension";

type SuggestionItem = ComposerChipAttrs & {
  description: string;
  trigger: "@" | "/";
};

type SuggestionState = {
  anchor: {
    left: number;
    top: number;
  };
  items: SuggestionItem[];
  range: {
    from: number;
    to: number;
  };
  trigger: "@" | "/";
  query: string;
};

const mentionItems: SuggestionItem[] = [
  {
    id: "riley",
    kind: "mention",
    label: "@riley",
    href: "convoy://user/riley",
    description: "Hardcoded user mention",
    trigger: "@",
  },
  {
    id: "robin",
    kind: "mention",
    label: "@robin",
    href: "convoy://user/robin",
    description: "Hardcoded user mention",
    trigger: "@",
  },
  {
    id: "design",
    kind: "mention",
    label: "@design",
    href: "convoy://group/design",
    description: "Hardcoded team mention",
    trigger: "@",
  },
];

const commandItems: SuggestionItem[] = [
  {
    id: "plan",
    kind: "command",
    label: "/plan",
    href: "convoy://command/plan",
    description: "Insert a plan-mode command chip",
    trigger: "/",
  },
  {
    id: "task",
    kind: "command",
    label: "/task",
    href: "convoy://command/task",
    description: "Insert a task-picker command chip",
    trigger: "/",
  },
  {
    id: "file",
    kind: "command",
    label: "/file",
    href: "convoy://command/file",
    description: "Insert a file-picker command chip",
    trigger: "/",
  },
];

const initialContent: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Type " },
        { type: "text", text: "@", marks: [{ type: "code" }] },
        { type: "text", text: " for mentions or " },
        { type: "text", text: "/", marks: [{ type: "code" }] },
        { type: "text", text: " for commands." },
      ],
    },
  ],
};

function serializeMarkdownNode(node: JSONContent): string {
  switch (node.type) {
    case "text":
      return node.text ?? "";
    case "hardBreak":
      return "  \n";
    case "composerChip": {
      const attrs = node.attrs as Partial<ComposerChipAttrs> | undefined;
      if (!attrs?.label || !attrs.href) {
        return "";
      }

      return `[${attrs.label}](${attrs.href})`;
    }
    case "paragraph":
      return (node.content ?? []).map(serializeMarkdownNode).join("");
    case "doc":
      return (node.content ?? [])
        .map((child) => serializeMarkdownNode(child).trimEnd())
        .filter((child) => child.length > 0)
        .join("\n\n");
    default:
      return (node.content ?? []).map(serializeMarkdownNode).join("");
  }
}

/**
 * Chips collapse to U+FFFC so they read as real content, but a `Shift+Enter`
 * hard break must read as whitespace or the trigger stays inert on every
 * continuation line (OS-1601) — mirrors the production composer.
 */
function suggestionLeafText(leafNode: ProseMirrorNode): string {
  return leafNode.type.name === "hardBreak" ? "\n" : "\uFFFC";
}

function getSuggestionState(editor: NonNullable<ReturnType<typeof useEditor>>): SuggestionState | null {
  const selection = editor.state.selection;
  if (!selection.empty) {
    return null;
  }

  const { $from } = selection;
  if (!$from.parent.isTextblock) {
    return null;
  }

  const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, suggestionLeafText);
  const match = /(?:^|\s)([@/][\w-]*)$/.exec(textBefore);
  if (!match) {
    return null;
  }

  const token = match[1];
  const trigger = token[0] as "@" | "/";
  const query = token.slice(1).toLowerCase();
  const items = (trigger === "@" ? mentionItems : commandItems).filter((item) =>
    item.label.slice(1).toLowerCase().includes(query)
  );
  const coords = editor.view.coordsAtPos(selection.from);

  return {
    anchor: {
      left: coords.left,
      top: coords.bottom,
    },
    trigger,
    query,
    items,
    range: {
      from: selection.from - token.length,
      to: selection.from,
    },
  };
}

export function TiptapComposerPlayground() {
  const [suggestion, setSuggestion] = useState<SuggestionState | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [markdown, setMarkdown] = useState("");
  const suggestionRef = useRef<SuggestionState | null>(null);
  const activeIndexRef = useRef(0);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        orderedList: false,
        bulletList: false,
      }),
      Placeholder.configure({
        placeholder: "Type @ for mentions or / for commands",
      }),
      ComposerChip,
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class:
          "min-h-32 w-full outline-none text-sm leading-6 text-foreground [&_.is-editor-empty:first-child::before]:pointer-events-none [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:text-muted-foreground [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]",
        "aria-label": "Thread composer playground",
        spellcheck: "false",
      },
      handleKeyDown: (_view, event) => {
        const currentSuggestion = suggestionRef.current;
        if (!currentSuggestion || currentSuggestion.items.length === 0) {
          return false;
        }

        switch (event.key) {
          case "ArrowDown":
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % currentSuggestion.items.length);
            return true;
          case "ArrowUp":
            event.preventDefault();
            setActiveIndex(
              (index) => (index - 1 + currentSuggestion.items.length) % currentSuggestion.items.length
            );
            return true;
          case "Enter":
          case "Tab": {
            event.preventDefault();
            const item =
              currentSuggestion.items[activeIndexRef.current] ?? currentSuggestion.items[0];
            if (!item || !editor) {
              return true;
            }

            editor
              .chain()
              .focus()
              .deleteRange(currentSuggestion.range)
              .insertComposerChip(item)
              .insertContent(" ")
              .run();
            return true;
          }
          case "Escape":
            event.preventDefault();
            setSuggestion(null);
            return true;
          default:
            return false;
        }
      },
    },
  });

  const syncFromEditor = useCallback(() => {
    if (!editor) {
      return;
    }

    const nextSuggestion = getSuggestionState(editor);
    suggestionRef.current = nextSuggestion;
    setSuggestion(nextSuggestion);
    setMarkdown(serializeMarkdownNode(editor.getJSON()));

    if (!nextSuggestion) {
      activeIndexRef.current = 0;
      setActiveIndex(0);
      return;
    }

    setActiveIndex((index) => {
      const nextIndex =
        nextSuggestion.items.length === 0 ? 0 : Math.min(index, nextSuggestion.items.length - 1);
      activeIndexRef.current = nextIndex;
      return nextIndex;
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    queueMicrotask(syncFromEditor);

    editor.on("update", syncFromEditor);
    editor.on("selectionUpdate", syncFromEditor);

    return () => {
      editor.off("update", syncFromEditor);
      editor.off("selectionUpdate", syncFromEditor);
    };
  }, [editor, syncFromEditor]);

  const previewMarkdown = useMemo(() => markdown.trim() || "_No markdown output yet._", [markdown]);
  const suggestionPosition = useMemo(() => {
    if (!suggestion || typeof window === "undefined") {
      return null;
    }

    const maxWidth = 288;
    const viewportPadding = 12;

    return {
      left: Math.max(
        viewportPadding,
        Math.min(suggestion.anchor.left - 14, window.innerWidth - maxWidth - viewportPadding)
      ),
      top: suggestion.anchor.top + 10,
      width: maxWidth,
    };
  }, [suggestion]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-6 py-10">
      <header className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Playground / Tiptap Composer
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          Hardcoded mentions, slash commands, markdown output.
        </h1>
        <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
          This is a playground-only prototype for `OS-619`: type `@` for visual mentions and `/` for
          command chips, then inspect the markdown result that would go on the wire.
        </p>
      </header>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
        <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">Composer</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Hardcoded values: `@riley`, `@robin`, `@design`, `/plan`, `/task`, `/file`.
            </p>
          </div>

          <div className="space-y-4 p-5">
            <div className="relative rounded-xl border border-border bg-background px-4 py-3 shadow-xs">
              <EditorContent
                editor={editor}
                className={cn(
                  "[&_span[data-composer-chip]]:mx-0.5 [&_span[data-composer-chip]]:inline-flex [&_span[data-composer-chip]]:align-middle [&_span[data-composer-chip]]:items-center [&_span[data-composer-chip]]:rounded-full [&_span[data-composer-chip]]:border [&_span[data-composer-chip]]:px-2 [&_span[data-composer-chip]]:py-px [&_span[data-composer-chip]]:text-[0.76rem] [&_span[data-composer-chip]]:font-medium [&_span[data-composer-chip]]:leading-4 [&_span[data-composer-chip='command']]:border-amber-500/30 [&_span[data-composer-chip='command']]:bg-amber-500/10 [&_span[data-composer-chip='command']]:text-amber-700 dark:[&_span[data-composer-chip='command']]:text-amber-300 [&_span[data-composer-chip='mention']]:border-primary/25 [&_span[data-composer-chip='mention']]:bg-primary/10 [&_span[data-composer-chip='mention']]:text-primary"
                )}
              />
            </div>

            <div className="rounded-xl border border-dashed border-border bg-background/50 px-4 py-3 text-sm text-muted-foreground">
              Start a token with `@` or `/` to open the hardcoded suggestion menu.
            </div>
          </div>
        </article>

        <div className="grid gap-6">
          <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">Markdown output</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Mentions and commands serialize as markdown links with custom Convoy schemes.
              </p>
            </div>
            <pre className="overflow-x-auto px-5 py-4 text-sm leading-6 text-foreground">
              <code>{markdown || "_No markdown output yet._"}</code>
            </pre>
          </article>

          <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">Rendered markdown preview</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Uses the existing app markdown renderer. Custom schemes are still rendered as links here.
              </p>
            </div>
            <div className="px-5 py-4">
              <MessageResponse>{previewMarkdown}</MessageResponse>
            </div>
          </article>

          <article className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-semibold text-foreground">Current mapping</h2>
            </div>
            <div className="space-y-3 px-5 py-4 text-sm text-muted-foreground">
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 size-4 text-primary" />
                <div>
                  Mentions serialize like <code className="text-foreground">[@riley](convoy://user/riley)</code>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <Sparkles className="mt-0.5 size-4 text-primary" />
                <div>
                  Commands serialize like <code className="text-foreground">[/plan](convoy://command/plan)</code>
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>

      {suggestion && suggestionPosition ? (
        <div
          className="fixed z-50 overflow-hidden rounded-xl border border-border bg-background p-1 shadow-2xl"
          style={suggestionPosition}
        >
          {suggestion.items.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              {suggestion.items.map((item, index) => {
                const ItemIcon = item.trigger === "@" ? AtSign : TerminalSquare;
                const isCommand = item.trigger === "/";

                return (
                  <button
                    key={item.id}
                    type="button"
                    className={cn(
                      "flex cursor-pointer items-center rounded-lg text-left transition-colors",
                      isCommand ? "h-8 gap-2 px-3 text-sm" : "gap-3 px-3 py-2",
                      index === activeIndex
                        ? "bg-muted/80 text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!editor) {
                        return;
                      }

                      editor
                        .chain()
                        .focus()
                        .deleteRange(suggestion.range)
                        .insertComposerChip(item)
                        .insertContent(" ")
                        .run();
                    }}
                  >
                    <span
                      className={cn(
                        "flex shrink-0 items-center justify-center text-muted-foreground",
                        isCommand
                          ? "size-4"
                          : "size-8 rounded-md border border-border bg-card"
                      )}
                    >
                      <ItemIcon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className={cn(isCommand ? "font-medium text-foreground" : "block truncate text-sm font-medium text-foreground")}>
                        {item.label}
                      </span>
                      {isCommand ? (
                        <span className="ml-2 text-muted-foreground">
                          {item.description}
                        </span>
                      ) : (
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-lg px-3 py-2 text-sm text-muted-foreground">
              No hardcoded matches for “{suggestion.query}”.
            </div>
          )}
        </div>
      ) : null}
    </main>
  );
}
