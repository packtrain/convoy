/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { useCellValue } from "@mdxeditor/editor";

import { createCodeBlockEditorDescriptor } from "./code-block-editor";

const renderDiagram = vi.hoisted(() => vi.fn());
const selectNode = vi.hoisted(() => vi.fn());

vi.mock("@mdxeditor/editor", () => ({
  CodeMirrorEditor: vi.fn(() => <div data-testid="code-mirror" />),
  editorInFocus$: {},
  useCellValue: vi.fn(() => null),
  useCodeBlockEditorContext: vi.fn(() => ({
    lexicalNode: { getKey: () => "node-1", select: selectNode },
    parentEditor: { update: vi.fn() },
    setLanguage: vi.fn(),
  })),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@streamdown/mermaid", () => ({
  mermaid: { getMermaid: () => ({ render: renderDiagram }) },
}));

describe("createCodeBlockEditorDescriptor", () => {
  test("accepts known aliases and unlabeled fences without metadata", () => {
    const descriptor = createCodeBlockEditorDescriptor();

    expect(descriptor.match("typescript", undefined)).toBe(true);
    expect(descriptor.match("bash", undefined)).toBe(true);
    expect(descriptor.match(undefined, undefined)).toBe(true);
  });

  test("accepts unknown no-meta languages as editable plain text fallback", () => {
    const descriptor = createCodeBlockEditorDescriptor();

    expect(descriptor.match("python", undefined)).toBe(true);
  });

  test("leaves metadata-specific fences for other descriptors", () => {
    const descriptor = createCodeBlockEditorDescriptor();

    expect(descriptor.match("typescript", "live")).toBe(false);
  });
});

describe("mermaid code blocks", () => {
  const { Editor } = createCodeBlockEditorDescriptor();
  const focusEmitter = { publish: vi.fn(), subscribe: vi.fn() };
  const renderBlock = (language: string, code = "graph TD; A-->B") =>
    render(
      <Editor code={code} language={language} meta="" nodeKey="node-1" focusEmitter={focusEmitter} />
    );

  beforeEach(() => {
    renderDiagram.mockReset();
    selectNode.mockReset();
  });

  test("renders the diagram and hides the source", async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg data-testid="diagram"></svg>' });
    const { container } = renderBlock("mermaid");

    expect(await screen.findByTestId("diagram")).toBeTruthy();
    expect(renderDiagram).toHaveBeenCalledWith(expect.any(String), "graph TD; A-->B");
    expect(container.querySelector("[data-source-hidden]")).not.toBeNull();
  });

  test("the edit button reveals and focuses the source", async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg data-testid="diagram"></svg>' });
    const { container } = renderBlock("mermaid");

    await screen.findByTestId("diagram");
    fireEvent.click(screen.getByRole("button", { name: "Edit diagram source" }));

    expect(container.querySelector("[data-source-hidden]")).toBeNull();
    expect(selectNode).toHaveBeenCalled();
  });

  test("folds back to the diagram once focus leaves the block", async () => {
    renderDiagram.mockResolvedValue({ svg: '<svg data-testid="diagram"></svg>' });
    const view = renderBlock("mermaid");
    const rerender = () =>
      view.rerender(
        <Editor code="graph TD; A-->B" language="mermaid" meta="" nodeKey="node-1" focusEmitter={focusEmitter} />
      );

    await screen.findByTestId("diagram");
    fireEvent.click(screen.getByRole("button", { name: "Edit diagram source" }));
    vi.mocked(useCellValue).mockReturnValue({ editorType: "codeblock", rootNode: { getKey: () => "node-1" } });
    rerender();
    expect(view.container.querySelector("[data-source-hidden]")).toBeNull();

    vi.mocked(useCellValue).mockReturnValue({ editorType: "lexical", rootNode: null });
    rerender();
    expect(view.container.querySelector("[data-source-hidden]")).not.toBeNull();
    vi.mocked(useCellValue).mockReturnValue(null);
  });

  test("shows the parse error and the source text when the diagram is invalid", async () => {
    renderDiagram.mockRejectedValue(new Error("Parse error on line 1"));
    renderBlock("mermaid", "graph TD; A-->");

    expect(await screen.findByText(/Parse error on line 1/)).toBeTruthy();
    expect(screen.getByText("graph TD; A-->")).toBeTruthy();
  });

  test("other languages keep the plain source editor", () => {
    const { container } = renderBlock("ts");

    expect(screen.queryByRole("button", { name: "Edit diagram source" })).toBeNull();
    expect(container.querySelector("[data-source-hidden]")).toBeNull();
    expect(renderDiagram).not.toHaveBeenCalled();
  });
});
