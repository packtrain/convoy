/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { SlashCommandCatalogItem } from "@/lib/slash-commands/composer";
import { buildSkillComposerItems } from "@/lib/slash-commands/composer";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { mockScrollable } from "@/test-utils/scroll";
import { POPOVER_SURFACE_CLASS } from "@/components/ui/popover";
import { routeTarget } from "@/lib/navigation";
import { PromptInputTiptapTextarea } from "./prompt-input-tiptap-textarea";

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/o/acme/OS/threads",
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
}));

const setInput = vi.fn();
let providerText = "";

vi.mock("@/components/ai-elements/prompt-input", () => ({
  usePromptInputAttachments: () => ({
    add: vi.fn(),
    files: [],
    remove: vi.fn(),
  }),
  usePromptInputController: () => ({
    textInput: {
      setInput,
      value: providerText,
    },
  }),
}));

type TiptapEditorElement = HTMLElement & { editor?: Editor };

const planCommand: SlashCommandCatalogItem = {
  id: "cmd_plan" as Id<"slashCommands">,
  scope: "organization",
  key: "plan",
  canonicalKey: "org:plan",
  displayLabel: "/plan",
  description: "Draft a plan",
  content: "Draft a plan for the work.",
  autoExpand: false,
  autoSubmit: true,
};

async function renderComposer(props: Partial<Parameters<typeof PromptInputTiptapTextarea>[0]> = {}) {
  render(<PromptInputTiptapTextarea placeholder="Ask" {...props} />);

  const textbox = (await screen.findByRole("textbox", {
    name: "Message",
  })) as TiptapEditorElement;
  const editor = textbox.editor;
  if (!editor) {
    throw new Error("editor not mounted");
  }

  return { textbox, editor };
}

describe("PromptInputTiptapTextarea", () => {
  afterEach(() => {
    cleanup();
    setInput.mockClear();
    providerText = "";
  });

  test.each([
    ["First line\nSecond line", "First line\nSecond line"],
    ["First line\nSecond line\n", "First line\nSecond line\n"],
    ["First line\nSecond line\n\n", "First line\nSecond line\n"],
  ])(
    "keeps placeholder styles off populated drafts after pasting %j",
    async (text, serializedText) => {
      const { textbox, editor } = await renderComposer();

      act(() => {
        editor.view.pasteText(text, new Event("paste") as ClipboardEvent);
      });

      expect(setInput).toHaveBeenLastCalledWith(serializedText);
      expect(editor.isEmpty).toBe(false);
      expect(textbox.querySelector("p.is-editor-empty:first-child")).toBeNull();
      // Global rich-text placeholder selector from paragraph-node.scss.
      expect(
        textbox.querySelector(".is-empty:not(.with-slash)[data-placeholder]:has(> .ProseMirror-trailingBreak:only-child)")
      ).toBeNull();
    }
  );

  test("restores the empty-editor placeholder after clearing a pasted draft", async () => {
    const { textbox, editor } = await renderComposer();
    expect(textbox.querySelector("p.is-editor-empty:first-child")?.getAttribute("data-placeholder")).toBe("Ask");

    act(() => {
      editor.view.pasteText("First line\nLast line\n", new Event("paste") as ClipboardEvent);
    });

    expect(editor.state.selection.$from.parent.textContent).toBe("");
    expect(textbox.querySelector("p.is-editor-empty:first-child")).toBeNull();
    expect(textbox.querySelector(".is-empty[data-placeholder]")).toBeNull();

    act(() => {
      editor.commands.clearContent();
    });

    expect(editor.isEmpty).toBe(true);
    expect(textbox.querySelector("p.is-editor-empty:first-child")?.getAttribute("data-placeholder")).toBe("Ask");
  });

  test("keeps placeholder styles off an empty paragraph selected within a populated draft", async () => {
    const { textbox, editor } = await renderComposer({ initialContent: "First line\n\nLast line" });

    act(() => {
      editor.commands.setTextSelection(13);
    });

    expect(editor.state.selection.$from.parent.textContent).toBe("");
    expect(editor.isEmpty).toBe(false);
    expect(textbox.querySelector("p.is-editor-empty:first-child")).toBeNull();
    expect(textbox.querySelector(".is-empty[data-placeholder]")).toBeNull();
  });

  // OS-2152: touch keyboards have no Shift+Enter, so Enter adds a line there.
  test("inserts a line break instead of submitting on Enter with a coarse pointer", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)" }));
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
    render(
      <form>
        <PromptInputTiptapTextarea placeholder="Ask" initialContent="First line" />
        <button type="submit">Send</button>
      </form>
    );
    const textbox = (await screen.findByRole("textbox", { name: "Message" })) as TiptapEditorElement;

    fireEvent.keyDown(textbox, { key: "Enter" });

    expect(requestSubmit).not.toHaveBeenCalled();
    expect(JSON.stringify(textbox.editor?.getJSON())).toContain('"hardBreak"');
    requestSubmit.mockRestore();
    vi.unstubAllGlobals();
  });

  test("keeps the caret in view immediately after Shift+Enter", async () => {
    render(<PromptInputTiptapTextarea placeholder="Ask" />);

    const textbox = (await screen.findByRole("textbox", {
      name: "Message",
    })) as TiptapEditorElement;
    const editor = textbox.editor;
    expect(editor).toBeDefined();

    const scrollRequests: boolean[] = [];
    editor?.on("transaction", ({ transaction }) => {
      scrollRequests.push(transaction.scrolledIntoView);
    });

    for (let index = 0; index < 8; index += 1) {
      fireEvent.keyDown(textbox, { key: "Enter", shiftKey: true });
      expect(scrollRequests.at(-1)).toBe(true);
    }

    expect(editor?.getJSON()).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: Array.from({ length: 8 }, () => ({ type: "hardBreak" })),
        },
      ],
    });
  });

  // Tiptap parses plain strings as HTML, which collapses "\n" into spaces —
  // multiline drafts (e.g. the artifact-comments handoff) must keep their
  // line structure when seeded.
  test("seeds multiline plain-text initialContent as one paragraph per line", async () => {
    render(
      <PromptInputTiptapTextarea
        placeholder="Ask"
        initialContent={"> quoted\nBody text\n\n(comment c1)"}
      />
    );

    const textbox = (await screen.findByRole("textbox", {
      name: "Message",
    })) as TiptapEditorElement;

    expect(textbox.editor?.getJSON()).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "> quoted" }] },
        { type: "paragraph", content: [{ type: "text", text: "Body text" }] },
        { type: "paragraph" },
        { type: "paragraph", content: [{ type: "text", text: "(comment c1)" }] },
      ],
    });
  });

  // OS-1601: Shift+Enter inserts a hardBreak *inside* the paragraph, so the
  // caret's preceding character must read as whitespace — otherwise neither
  // trigger fires on any line but the first.
  test("opens the slash menu on a line started with Shift+Enter", async () => {
    const { textbox, editor } = await renderComposer({ slashCommands: [planCommand] });

    editor.commands.insertContent("intro text");
    fireEvent.keyDown(textbox, { key: "Enter", shiftKey: true });
    editor.commands.insertContent("/pl");

    expect(await screen.findByRole("button", { name: /\/plan/ })).toBeDefined();
  });

  test("opens the file-mention menu on a line started with Shift+Enter", async () => {
    const { textbox, editor } = await renderComposer({
      fileMention: { profileId: "p1", pathId: "path1", isProfileOnline: true },
    });

    editor.commands.insertContent("intro text");
    fireEvent.keyDown(textbox, { key: "Enter", shiftKey: true });
    editor.commands.insertContent("@src");

    // No Convex provider in unit tests, so the search stays inert and the menu
    // renders its empty state — enough to prove the trigger opened.
    expect(await screen.findByText("No files found")).toBeDefined();
  });

  // OS-2198: the menu portals outside a hosting drawer, whose scroll lock swallowed its scroll.
  test("keeps the suggestion menu scrollable inside a drawer", async () => {
    render(
      <Drawer open direction="right">
        <DrawerContent>
          <DrawerTitle>Thread</DrawerTitle>
          <DrawerDescription>Composer</DrawerDescription>
          <PromptInputTiptapTextarea placeholder="Ask" slashCommands={[planCommand]} />
        </DrawerContent>
      </Drawer>
    );
    const textbox = (await screen.findByRole("textbox", { name: "Message" })) as TiptapEditorElement;
    act(() => {
      textbox.editor?.commands.insertContent("/pl");
    });

    const item = await screen.findByRole("button", { name: /\/plan/ });
    const menu = mockScrollable(item.closest<HTMLElement>("div.fixed")!);
    expect(fireEvent.wheel(menu, { deltaY: 50 })).toBe(true);
  });

  test("the suggestion menu uses the shared popover surface", async () => {
    const { editor } = await renderComposer({ slashCommands: [planCommand] });

    editor.commands.insertContent("/pl");
    const item = await screen.findByRole("button", { name: /\/plan/ });
    const menu = item.closest<HTMLElement>("div.fixed")!;
    for (const token of POPOVER_SURFACE_CLASS.split(" ")) expect(menu.classList).toContain(token);
  });

  // OS-1679: the menu is portalled to document.body, so a focus-out that leaves
  // the composer mounted (the group "+", a panel tab overlaying the thread
  // column) would otherwise leave it floating over the incoming surface.
  test("closes the suggestion menu when the editor loses focus", async () => {
    const { textbox, editor } = await renderComposer({ slashCommands: [planCommand] });

    editor.commands.insertContent("/pl");
    expect(await screen.findByRole("button", { name: /\/plan/ })).toBeDefined();

    fireEvent.blur(textbox);

    await vi.waitFor(() => expect(screen.queryByRole("button", { name: /\/plan/ })).toBeNull());
  });

  // Hard breaks are whitespace, so a command selected as the only real content
  // of a multiline draft still autosubmits (docs/specs/slash-commands.md).
  test("autosubmits a selected command when the draft only holds hard breaks", async () => {
    const onAutoSubmit = vi.fn();
    const { textbox, editor } = await renderComposer({
      slashCommands: [planCommand],
      onAutoSubmit,
    });

    fireEvent.keyDown(textbox, { key: "Enter", shiftKey: true });
    editor.commands.insertContent("/plan");

    fireEvent.click(await screen.findByRole("button", { name: /\/plan/ }));

    await vi.waitFor(() => expect(onAutoSubmit).toHaveBeenCalledTimes(1));
  });

  // Atom pills must keep counting as real content: only hard breaks changed.
  test("does not autosubmit when another command pill is already in the draft", async () => {
    const onAutoSubmit = vi.fn();
    const { editor } = await renderComposer({
      slashCommands: [planCommand],
      onAutoSubmit,
    });

    editor
      .chain()
      .insertSlashCommand({
        type: "slash-command",
        id: planCommand.id,
        scope: planCommand.scope,
        key: planCommand.key,
        canonicalKey: planCommand.canonicalKey,
        displayLabel: planCommand.displayLabel,
      })
      .insertContent(" /plan")
      .run();

    fireEvent.click(await screen.findByRole("button", { name: /\/plan/ }));

    expect(onAutoSubmit).not.toHaveBeenCalled();
  });

  // OS-1784: a Skill mention names the Skill; the agent loads the body itself.
  test("inserts a selected skill as a pill that serializes to a skill link", async () => {
    const onChange = vi.fn();
    const onComposerDocumentChange = vi.fn();
    const [pdfSkill] = buildSkillComposerItems([{ _id: "skill_pdf" as Id<"skills">, name: "pdf-tools", description: "Fill PDFs" }]);
    const { editor } = await renderComposer({
      slashCommands: [pdfSkill],
      onChange,
      onComposerDocumentChange,
    });

    editor.commands.insertContent("/pdf");
    const row = await screen.findByRole("button", { name: /\/pdf-tools/ });
    expect(screen.getByText("Skill")).toBeDefined();
    fireEvent.click(row);

    await vi.waitFor(() => expect(onChange).toHaveBeenLastCalledWith("[/pdf-tools](convoy://skill/pdf-tools) "));
    expect(onComposerDocumentChange).toHaveBeenLastCalledWith({
      version: 1,
      refs: [
        {
          type: "skill",
          id: "skill_pdf",
          scope: "skill",
          key: "pdf-tools",
          canonicalKey: "skill:pdf-tools",
          displayLabel: "/pdf-tools",
        },
      ],
    });
  });

  // Two catalogs now resolve independently (Prompts, Skills), so one can land
  // while the menu is already open — it must not wait for the next keystroke.
  test("refreshes an open menu when the catalog resolves", async () => {
    const [pdfSkill] = buildSkillComposerItems([{ _id: "skill_pdf" as Id<"skills">, name: "pdf-tools" }]);
    const { rerender } = render(<PromptInputTiptapTextarea placeholder="Ask" slashCommands={[planCommand]} />);

    const textbox = (await screen.findByRole("textbox", { name: "Message" })) as TiptapEditorElement;
    textbox.editor?.commands.insertContent("/pdf");
    // The menu searches Prompts, agent commands and Skills, so it says results.
    await vi.waitFor(() => expect(screen.getByText("No results found")).toBeDefined());

    rerender(<PromptInputTiptapTextarea placeholder="Ask" slashCommands={[planCommand, pdfSkill]} />);

    expect(await screen.findByRole("button", { name: /\/pdf-tools/ })).toBeDefined();
  });

  // OS-2429: one card follows the hovered prompt row; the delay only gates the first open.
  test("previews a hovered prompt after 1s and swaps instantly between prompts", async () => {
    const reviewCommand: SlashCommandCatalogItem = {
      ...planCommand,
      id: "cmd_review" as Id<"slashCommands">,
      key: "review",
      canonicalKey: "org:review",
      displayLabel: "/review",
      description: "Review the diff",
      content: "Review **every** hunk.",
    };
    const [pdfSkill] = buildSkillComposerItems([{ _id: "skill_pdf" as Id<"skills">, name: "pdf-tools" }]);
    const { editor } = await renderComposer({ slashCommands: [planCommand, reviewCommand, pdfSkill] });
    editor.commands.insertContent("/");
    const planRow = await screen.findByRole("button", { name: /\/plan/ });
    const reviewRow = screen.getByRole("button", { name: /\/review/ });
    const skillRow = screen.getByRole("button", { name: /\/pdf-tools/ });

    vi.useFakeTimers();
    try {
      fireEvent.pointerEnter(skillRow);
      act(() => vi.advanceTimersByTime(1000));
      expect(screen.queryByRole("dialog")).toBeNull();

      fireEvent.pointerEnter(planRow);
      act(() => vi.advanceTimersByTime(999));
      expect(screen.queryByRole("dialog")).toBeNull();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.getByRole("dialog").textContent).toContain("Draft a plan for the work.");

      fireEvent.pointerEnter(reviewRow);
      const card = screen.getByRole("dialog");
      expect(card.textContent).not.toContain("Draft a plan for the work.");
      expect(card.querySelector("[data-streamdown=strong]")?.textContent).toBe("every");
      // The description spans the card instead of stopping at the badge's column.
      const badgeRow = within(card).getByText("Organization").parentElement!;
      expect(badgeRow.contains(within(card).getByText("Review the diff"))).toBe(false);

      fireEvent.pointerLeave(reviewRow.closest("[data-slash-command-menu]")!);
      act(() => vi.advanceTimersByTime(150));
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // OS-2428: a manageable Prompt row trades its scope badge for an edit link on hover.
  test("links a manageable prompt row to its settings page and closes the menu on click", async () => {
    const [pdfSkill] = buildSkillComposerItems([{ _id: "skill_pdf" as Id<"skills">, name: "pdf-tools" }]);
    const { editor } = await renderComposer({
      slashCommands: [planCommand, pdfSkill],
      getPromptEditHref: (item) => routeTarget(`/o/acme/settings/prompts/${item.id}`),
    });
    editor.commands.insertContent("/");

    const edit = await screen.findByRole("link", { name: "Edit /plan" });
    expect(edit.getAttribute("href")).toBe("/o/acme/settings/prompts/cmd_plan");
    expect(screen.queryByRole("link", { name: "Edit /pdf-tools" })).toBeNull();

    expect(fireEvent.mouseDown(edit)).toBe(false);
    fireEvent.click(edit);
    expect(routerPush).toHaveBeenCalledWith("/o/acme/settings/prompts/cmd_plan", expect.anything());
    expect(screen.queryByRole("button", { name: /\/plan/ })).toBeNull();
  });

  test("keeps newlines when syncing multiline text from the provider", async () => {
    const { rerender } = render(<PromptInputTiptapTextarea placeholder="Ask" />);

    const textbox = (await screen.findByRole("textbox", {
      name: "Message",
    })) as TiptapEditorElement;

    providerText = "line one\nline two";
    rerender(<PromptInputTiptapTextarea placeholder="Ask" />);

    expect(textbox.editor?.getJSON()).toEqual({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "line one" }] },
        { type: "paragraph", content: [{ type: "text", text: "line two" }] },
      ],
    });
  });
});
