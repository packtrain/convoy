/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi, beforeEach } from "vitest";
import { fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MdxEditor } from "./editor";

type MdxEditorMockProps = {
  contentEditableClassName?: string;
  iconComponentFor?: (name: string) => ReactNode;
  markdown?: string;
  onChange?: (markdown: string, initialMarkdownNormalize?: boolean) => void;
  plugins?: Array<unknown>;
};

type MdxEditorMockMethods = {
  getMarkdown: () => string;
  setMarkdown: (value: string) => void;
  insertMarkdown: (value: string) => void;
  focus: () => void;
};

const mdxEditorMock = vi.hoisted(() => vi.fn());
const setMarkdownMock = vi.hoisted(() => vi.fn());
const kitToolbarPluginMock = vi.hoisted(() =>
  vi.fn(({ showDiffMode }: { showDiffMode: boolean }) => ({ showDiffMode }))
);
const diffSourcePluginMock = vi.hoisted(() => vi.fn((config: unknown) => config));
const thematicBreakPluginMock = vi.hoisted(() => vi.fn(() => ({ type: "thematicBreakPlugin" })));
const tablePluginMock = vi.hoisted(() => vi.fn(() => ({ type: "tablePlugin" })));
const { useIsMobileMock } = vi.hoisted(() => ({
  useIsMobileMock: vi.fn(() => false),
}));
const { useThemeMock } = vi.hoisted(() => ({
  useThemeMock: vi.fn((): { resolvedTheme?: string } => ({ resolvedTheme: "dark" })),
}));

vi.mock("next-themes", () => ({
  useTheme: useThemeMock,
}));

vi.mock("@/hooks/browser/use-mobile", () => ({
  useIsMobile: useIsMobileMock,
}));

vi.mock("@mdxeditor/editor", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const MockMdxEditor = React.forwardRef<MdxEditorMockMethods, MdxEditorMockProps>(
    (props, ref) => {
      React.useImperativeHandle(ref, () => ({
        getMarkdown: () => props.markdown ?? "",
        setMarkdown: setMarkdownMock,
        insertMarkdown: vi.fn(),
        focus: vi.fn(),
      }));
      mdxEditorMock(props);
      return <div data-testid="mock-mdx-editor" />;
    }
  );
  MockMdxEditor.displayName = "MockMdxEditor";

  return {
    MDXEditor: MockMdxEditor,
    AdmonitionDirectiveDescriptor: {},
    codeBlockPlugin: vi.fn((config: unknown) => ({ type: "codeBlockPlugin", config })),
    codeMirrorPlugin: vi.fn((config: unknown) => ({ type: "codeMirrorPlugin", config })),
    directivesPlugin: vi.fn((config: unknown) => ({ type: "directivesPlugin", config })),
    diffSourcePlugin: (config: unknown) => diffSourcePluginMock(config),
    headingsPlugin: vi.fn(() => ({ type: "headingsPlugin" })),
    linkDialogPlugin: vi.fn((config: unknown) => ({ type: "linkDialogPlugin", config })),
    linkPlugin: vi.fn(() => ({ type: "linkPlugin" })),
    listsPlugin: vi.fn(() => ({ type: "listsPlugin" })),
    markdownShortcutPlugin: vi.fn(() => ({ type: "markdownShortcutPlugin" })),
    quotePlugin: vi.fn(() => ({ type: "quotePlugin" })),
    tablePlugin: () => tablePluginMock(),
    thematicBreakPlugin: () => thematicBreakPluginMock(),
  };
});

vi.mock("./code-block-editor", () => ({
  codeBlockLanguages: { txt: "Plain text" },
  createCodeBlockEditorDescriptor: vi.fn(() => ({ type: "codeBlockEditorDescriptor" })),
}));

vi.mock("./toolbar", () => ({
  kitToolbarPlugin: (config: { showDiffMode: boolean }) => kitToolbarPluginMock(config),
}));

describe("MdxEditor", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useIsMobileMock.mockReturnValue(false);
    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
    mdxEditorMock.mockReset();
    setMarkdownMock.mockClear();
    kitToolbarPluginMock.mockClear();
    diffSourcePluginMock.mockClear();
    thematicBreakPluginMock.mockClear();
    tablePluginMock.mockClear();
  });

  test("applies compact density, disabled state, and source-only mode config", () => {
    const { container } = render(
      <MdxEditor
        value="# Heading"
        onChange={vi.fn()}
        density="compact"
        disabled={true}
        showDiffMode={false}
      />
    );

    const root = container.firstElementChild as HTMLDivElement;
    expect(root.getAttribute("data-density")).toBe("compact");
    expect(root.hasAttribute("data-content-padding")).toBe(false);
    expect(root.getAttribute("aria-disabled")).toBe("true");
    expect(root.className).toContain("mdx-editor-kit");

    const editorProps = mdxEditorMock.mock.calls[0]?.[0] as MdxEditorMockProps & {
      className?: string;
    };
    expect(editorProps.className).toContain("pointer-events-none");

    expect(kitToolbarPluginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        showDiffMode: false,
        stickyToolbar: false,
      })
    );
    expect(diffSourcePluginMock).toHaveBeenCalledWith({
      diffMarkdown: "# Heading",
      viewMode: "rich-text",
    });
    expect(mdxEditorMock).toHaveBeenCalled();
  });

  test("exposes spacious content padding only when requested", () => {
    const { container } = render(
      <MdxEditor
        value="# Heading"
        onChange={vi.fn()}
        density="compact"
        contentPadding="spacious"
      />
    );

    const root = container.firstElementChild as HTMLDivElement;
    expect(root.getAttribute("data-density")).toBe("compact");
    expect(root.getAttribute("data-content-padding")).toBe("spacious");
  });

  test("keeps spacing between headings and following paragraphs", () => {
    render(<MdxEditor value={"# Heading\n\nParagraph"} onChange={vi.fn()} />);

    const props = mdxEditorMock.mock.calls[0]?.[0] as MdxEditorMockProps;

    expect(props.contentEditableClassName).toContain("[&_h1+p]:mt-4");
    expect(props.contentEditableClassName).toContain("[&_h2+p]:mt-3");
    expect(props.contentEditableClassName).toContain("[&_h3+p]:mt-3");
    expect(props.contentEditableClassName).toContain("[&_h4+p]:mt-2");
  });

  test("marks the default inline table of contents as left-positioned", () => {
    const { container } = render(
      <MdxEditor
        value={"# Heading\n\nParagraph"}
        onChange={vi.fn()}
        inlineTableOfContents={true}
      />
    );

    const root = container.firstElementChild as HTMLDivElement;

    expect(root.getAttribute("data-inline-toc")).toBe("true");
    expect(root.getAttribute("data-inline-toc-position")).toBe("left");
  });

  test("can mark the inline table of contents as right-positioned", () => {
    const { container } = render(
      <MdxEditor
        value={"# Heading\n\nParagraph"}
        onChange={vi.fn()}
        inlineTableOfContents={{ position: "right" }}
      />
    );

    const root = container.firstElementChild as HTMLDivElement;

    expect(root.getAttribute("data-inline-toc")).toBe("true");
    expect(root.getAttribute("data-inline-toc-position")).toBe("right");
  });

  test("registers the responsive table of contents action during initial toolbar setup", () => {
    render(
      <MdxEditor
        value={"# Heading\n\nParagraph"}
        onChange={vi.fn()}
        inlineTableOfContents={true}
      />
    );

    const initialToolbarConfig = kitToolbarPluginMock.mock.calls[0]?.[0] as {
      mobileTableOfContents?: React.ReactNode;
    };

    expect(initialToolbarConfig.mobileTableOfContents).toBeTruthy();
  });

  test("uses a toolbar drawer action instead of rendering the floating table of contents on mobile", () => {
    useIsMobileMock.mockReturnValue(true);

    const { container } = render(
      <MdxEditor
        value={"# Heading\n\nParagraph"}
        onChange={vi.fn()}
        inlineTableOfContents={true}
      />
    );

    const root = container.firstElementChild as HTMLDivElement;
    const toolbarConfig = kitToolbarPluginMock.mock.calls[0]?.[0] as {
      mobileTableOfContents?: React.ReactNode;
    };

    expect(root.hasAttribute("data-inline-toc")).toBe(false);
    expect(within(container).queryByRole("button", { name: "Pin table of contents" })).toBeNull();
    expect(toolbarConfig.mobileTableOfContents).toBeTruthy();
  });

  test("pins the inline table of contents into a sidebar and unpins back to the flyout", () => {
    const { container } = render(
      <MdxEditor
        value={"# Heading\n\nParagraph"}
        onChange={vi.fn()}
        inlineTableOfContents={true}
      />
    );

    const root = container.firstElementChild as HTMLDivElement;
    const view = within(container);
    expect(root.getAttribute("data-inline-toc")).toBe("true");

    fireEvent.click(view.getByRole("button", { name: "Pin table of contents" }));

    expect(root.hasAttribute("data-inline-toc")).toBe(false);
    expect(view.queryByRole("button", { name: "Pin table of contents" })).toBeNull();
    expect(window.localStorage.getItem("convoy.mdx-editor.toc-pinned")).toBe("true");

    fireEvent.click(view.getByRole("button", { name: "Unpin table of contents" }));

    expect(root.getAttribute("data-inline-toc")).toBe("true");
    expect(view.queryByRole("button", { name: "Unpin table of contents" })).toBeNull();
    expect(window.localStorage.getItem("convoy.mdx-editor.toc-pinned")).toBe("false");
  });

  test("restores the pinned table of contents from localStorage", () => {
    window.localStorage.setItem("convoy.mdx-editor.toc-pinned", "true");

    const { container } = render(
      <MdxEditor
        value={"# Heading\n\nParagraph"}
        onChange={vi.fn()}
        inlineTableOfContents={true}
      />
    );

    const root = container.firstElementChild as HTMLDivElement;
    expect(root.hasAttribute("data-inline-toc")).toBe(false);
    expect(
      within(container).getByRole("button", { name: "Unpin table of contents" })
    ).toBeTruthy();
  });

  test("passes sticky toolbar configuration only when requested", () => {
    render(<MdxEditor value={"# Heading"} onChange={vi.fn()} stickyToolbar={true} />);

    expect(kitToolbarPluginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        showDiffMode: true,
        stickyToolbar: true,
      })
    );

    mdxEditorMock.mockClear();
    kitToolbarPluginMock.mockClear();

    render(<MdxEditor value={"# Heading"} onChange={vi.fn()} />);

    expect(kitToolbarPluginMock).toHaveBeenCalledWith(
      expect.objectContaining({
        showDiffMode: true,
        stickyToolbar: false,
      })
    );
  });

  test("can render without the toolbar plugin for read-only markdown", () => {
    render(
      <MdxEditor
        value={"# Heading"}
        onChange={vi.fn()}
        disabled
        toolbar={false}
      />
    );

    expect(kitToolbarPluginMock).not.toHaveBeenCalled();
    expect(mdxEditorMock).toHaveBeenCalled();
  });

  test("normalizes unsafe markdown before initial rich-text import", () => {
    render(
      <MdxEditor value={"They'll be invited as <project role>."} onChange={vi.fn()} />
    );

    const props = mdxEditorMock.mock.calls[0]?.[0] as MdxEditorMockProps;

    expect(props.markdown).toBe("They'll be invited as \\<project role>.");
    expect(diffSourcePluginMock).toHaveBeenCalledWith({
      diffMarkdown: "They'll be invited as \\<project role>.",
      viewMode: "rich-text",
    });
  });

  test("removes editor-only angle escapes before publishing changes", () => {
    const onChange = vi.fn();
    render(<MdxEditor value={"They'll be invited as <project role>."} onChange={onChange} />);

    const props = mdxEditorMock.mock.calls[0]?.[0] as MdxEditorMockProps;
    props.onChange?.("They'll be invited as \\<project role>.");

    expect(onChange).toHaveBeenLastCalledWith("They'll be invited as <project role>.");
  });

  test("publishes the original source after MDXEditor's initial normalization", () => {
    const onChange = vi.fn();
    const value = "They'll be invited as <project role>.";
    render(<MdxEditor value={value} onChange={onChange} />);

    const props = mdxEditorMock.mock.calls[0]?.[0] as MdxEditorMockProps;
    props.onChange?.("They'll be invited as \\<project role>.", true);

    expect(onChange).toHaveBeenLastCalledWith(value);
  });

  test("normalizes prose colon directives before initial rich-text import", () => {
    render(<MdxEditor value={"Run pnpm web:lint before finishing."} onChange={vi.fn()} />);

    const props = mdxEditorMock.mock.calls[0]?.[0] as MdxEditorMockProps;

    expect(props.markdown).toBe("Run pnpm web\\:lint before finishing.");
    expect(diffSourcePluginMock).toHaveBeenCalledWith({
      diffMarkdown: "Run pnpm web\\:lint before finishing.",
      viewMode: "rich-text",
    });
  });

  test("registers thematic break support for horizontal rules", () => {
    render(<MdxEditor value={"Before\n\n---\n\nAfter"} onChange={vi.fn()} />);

    const props = mdxEditorMock.mock.calls[0]?.[0] as MdxEditorMockProps;

    expect(thematicBreakPluginMock).toHaveBeenCalled();
    expect(props.plugins).toContainEqual({ type: "thematicBreakPlugin" });
  });

  test("registers GitHub-flavored markdown table support", () => {
    render(
      <MdxEditor
        value={"| Name | Status |\n| --- | --- |\n| Playground | Ready |"}
        onChange={vi.fn()}
      />
    );

    const props = mdxEditorMock.mock.calls[0]?.[0] as MdxEditorMockProps;

    expect(tablePluginMock).toHaveBeenCalled();
    expect(props.plugins).toContainEqual({ type: "tablePlugin" });
  });

  test("pushes external value changes into the mounted editor", () => {
    const { rerender } = render(
      <MdxEditor value={"Initial prompt"} onChange={vi.fn()} />
    );

    expect(setMarkdownMock).not.toHaveBeenCalled();

    rerender(<MdxEditor value={"Expanded prompt edit"} onChange={vi.fn()} />);

    expect(setMarkdownMock).toHaveBeenCalledWith("Expanded prompt edit");
  });

  test("follows the resolved app theme unless a theme is passed", () => {
    useThemeMock.mockReturnValue({ resolvedTheme: "light" });
    const { container, rerender } = render(<MdxEditor value="Text" onChange={vi.fn()} />);
    const root = container.firstElementChild as HTMLDivElement;

    expect(root.classList.contains("mdx-editor-kit--light")).toBe(true);

    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
    rerender(<MdxEditor value="Text" onChange={vi.fn()} />);
    expect(root.classList.contains("mdx-editor-kit--dark")).toBe(true);

    rerender(<MdxEditor value="Text" onChange={vi.fn()} theme="light" />);
    expect(root.classList.contains("mdx-editor-kit--light")).toBe(true);
  });

  test("renders a glyph for every table control icon", () => {
    render(<MdxEditor value="Text" onChange={vi.fn()} />);
    const props = mdxEditorMock.mock.calls[0]?.[0] as MdxEditorMockProps;
    const tableIcons = [
      "add_row",
      "add_column",
      "more_horiz",
      "delete_small",
      "insert_row_above",
      "insert_row_below",
      "insert_col_left",
      "insert_col_right",
      "format_align_left",
      "format_align_center",
      "format_align_right",
    ];

    for (const name of tableIcons) {
      const { container, unmount } = render(<>{props.iconComponentFor?.(name)}</>);
      expect(container.querySelector("svg"), name).not.toBeNull();
      unmount();
    }

    const { container } = render(<>{props.iconComponentFor?.("add_row")}</>);
    expect(container.querySelector("svg")?.classList.contains("lucide-plus")).toBe(true);
  });
});
