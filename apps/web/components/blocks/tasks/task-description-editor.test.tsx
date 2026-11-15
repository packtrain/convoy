/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { TaskDescriptionEditor } from "@/components/blocks/tasks/task-description-editor";

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}));

const markdownMocks = vi.hoisted(() => ({
  serializeTaskDescriptionDocAsMarkdown: vi.fn(() => "# Copied description"),
}));

const editorMocks = vi.hoisted(() => {
  const run = vi.fn();
  const focus = vi.fn(() => ({ run }));
  const chain = vi.fn(() => ({ focus }));
  const doc = { type: { name: "doc" } };

  return {
    run,
    focus,
    chain,
    doc,
    editor: {
      chain,
      can: vi.fn(() => ({
        redo: vi.fn(() => true),
        undo: vi.fn(() => true),
      })),
      commands: {
        setContent: vi.fn(),
      },
      getJSON: vi.fn(() => ({ type: "doc", content: [{ type: "paragraph" }] })),
      isActive: vi.fn(() => false),
      isEditable: true,
      isEmpty: true,
      off: vi.fn(),
      on: vi.fn(),
      state: {
        doc,
        selection: {
          from: 0,
          to: 0,
        },
      },
    },
  };
});

vi.mock("sonner", () => ({
  toast: toastMocks,
}));

vi.mock("convex/react", () => ({
  useConvex: () => ({
    query: vi.fn(),
  }),
  useMutation: () => vi.fn(),
}));

vi.mock("@tiptap/react", () => ({
  EditorContext: {
    Provider: ({ children }: { children: ReactNode }) => children,
  },
  EditorContent: ({
    className,
  }: {
    className?: string;
  }) => (
    <div
      data-testid="editor-content"
      className={className}
    >
      <div data-testid="prosemirror" className="ProseMirror" />
    </div>
  ),
  useCurrentEditor: () => ({ editor: editorMocks.editor }),
  useEditor: () => editorMocks.editor,
  useEditorState: () => ({
    editor: editorMocks.editor,
    editorState: editorMocks.editor.state,
    canCommand: editorMocks.editor.can,
  }),
}));

vi.mock("@/lib/tasks/task-description-markdown", () => markdownMocks);

vi.mock("@/components/tiptap-ui/undo-redo-button", () => ({
  UndoRedoButton: ({ action }: { action: string }) => (
    <button type="button">Undo redo {action}</button>
  ),
}));

vi.mock("@/components/tiptap-ui/heading-dropdown-menu", () => ({
  HeadingDropdownMenu: () => <button type="button">Heading</button>,
}));

vi.mock("@/components/tiptap-ui/list-dropdown-menu", () => ({
  ListDropdownMenu: () => <button type="button">List</button>,
}));

vi.mock("@/components/tiptap-ui/blockquote-button", () => ({
  BlockquoteButton: () => <button type="button">Blockquote</button>,
}));

vi.mock("@/components/tiptap-ui/code-block-button", () => ({
  CodeBlockButton: () => <button type="button">Code block</button>,
}));

vi.mock("@/components/tiptap-ui/color-highlight-popover", () => ({
  ColorHighlightPopover: () => <button type="button">Highlight</button>,
}));

vi.mock("@/components/tiptap-ui/link-popover", () => ({
  LinkPopover: () => <button type="button">Link</button>,
}));

vi.mock("@/components/tiptap-ui/mark-button", () => ({
  MarkButton: ({ type }: { type: string }) => <button type="button">{type}</button>,
}));

vi.mock("@/components/tiptap-ui/text-align-button", () => {
  const Icon = () => <svg />;
  return {
    TextAlignButton: ({ text }: { text: string }) => <button type="button">{text}</button>,
    textAlignIcons: {
      left: Icon,
      center: Icon,
      right: Icon,
      justify: Icon,
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskDescriptionEditor", () => {
  test("keeps the toolbar in document flow at narrow widths", () => {
    render(
      <TaskDescriptionEditor
        value={null}
        onSave={vi.fn()}
      />
    );

    const toolbar = screen.getByRole("toolbar", { name: "toolbar" });
    expect(toolbar.className).toContain("!sticky");
    expect(toolbar.className).toContain("!border-b");
    expect(toolbar.className).toContain("!border-border");
  });

  test("copies the current description as markdown", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <TaskDescriptionEditor
        value={null}
        onSave={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy as markdown" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("# Copied description");
    });
    expect(markdownMocks.serializeTaskDescriptionDocAsMarkdown).toHaveBeenCalledWith(
      editorMocks.doc
    );
    expect(toastMocks.success).toHaveBeenCalledWith("Description copied as markdown");
  });

  test("reports unavailable clipboard support when copying markdown", () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });

    render(
      <TaskDescriptionEditor
        value={null}
        onSave={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy as markdown" }));

    expect(toastMocks.error).toHaveBeenCalledWith("Clipboard is unavailable");
  });
});
