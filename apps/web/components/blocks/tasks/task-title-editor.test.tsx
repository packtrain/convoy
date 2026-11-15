/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { TaskTitleEditor } from "./task-title-editor";

function getEditor() {
  return screen.getByRole("textbox", { name: "Task name" }) as HTMLTextAreaElement;
}

describe("TaskTitleEditor", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders textarea with expected baseline behavior and placeholder", () => {
    render(<TaskTitleEditor value="Task name" onCommit={vi.fn()} />);

    const editor = getEditor();
    expect(editor.tagName).toBe("TEXTAREA");
    expect(editor.placeholder).toBe("Task name");
    expect(editor.className).toContain("resize-none");
    expect(editor.className).toContain("overflow-y-auto");
  });

  test("keeps long text as soft-wrapped textarea content without inserting hard new lines", () => {
    render(
      <TaskTitleEditor
        value="This is a very long task title that should wrap based on container width"
        onCommit={vi.fn()}
      />
    );

    const editor = getEditor();
    expect(editor.value.includes("\n")).toBe(false);
    expect(editor.className).toContain("whitespace-pre-wrap");
  });

  test("prevents Enter and Shift+Enter from adding new lines", () => {
    render(<TaskTitleEditor value="Task title" onCommit={vi.fn()} />);

    const editor = getEditor();

    const enterEvent = createEvent.keyDown(editor, { key: "Enter" });
    fireEvent(editor, enterEvent);
    expect(enterEvent.defaultPrevented).toBe(true);
    expect(editor.value).toBe("Task title");

    const shiftEnterEvent = createEvent.keyDown(editor, {
      key: "Enter",
      shiftKey: true,
    });
    fireEvent(editor, shiftEnterEvent);
    expect(shiftEnterEvent.defaultPrevented).toBe(true);
    expect(editor.value).toBe("Task title");
  });

  test("escape cancels draft and reverts to current value without committing", () => {
    const onCommit = vi.fn();
    render(<TaskTitleEditor value="Task title" onCommit={onCommit} />);

    const editor = getEditor();
    fireEvent.focus(editor);
    fireEvent.change(editor, {
      target: { value: "Draft title" },
    });

    fireEvent.keyDown(editor, { key: "Escape" });

    expect(onCommit).not.toHaveBeenCalled();
    expect(editor.value).toBe("Task title");
  });

  test("sanitizes pasted or typed multiline content into single-line spacing", () => {
    render(<TaskTitleEditor value="Task title" onCommit={vi.fn()} />);
    const editor = getEditor();

    fireEvent.change(editor, {
      target: { value: "Line 1\nLine 2\r\nLine 3" },
    });

    expect(editor.value).toBe("Line 1 Line 2 Line 3");
  });

  test("commits normalized value on blur when changed", () => {
    const onCommit = vi.fn();
    render(<TaskTitleEditor value="Task title" onCommit={onCommit} />);
    const editor = getEditor();

    fireEvent.change(editor, {
      target: { value: "  Updated   task   title  " },
    });
    fireEvent.blur(editor);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("Updated task title");
  });

  test("does not commit when normalized value is unchanged", () => {
    const onCommit = vi.fn();
    render(<TaskTitleEditor value="Task title" onCommit={onCommit} />);
    const editor = getEditor();

    fireEvent.change(editor, {
      target: { value: "  Task   title  " },
    });
    fireEvent.blur(editor);

    expect(onCommit).not.toHaveBeenCalled();
  });

  test("reverts to server value when normalized draft is empty", () => {
    const onCommit = vi.fn();
    render(<TaskTitleEditor value="Task title" onCommit={onCommit} />);
    const editor = getEditor();

    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: "   " } });
    fireEvent.blur(editor);

    expect(onCommit).not.toHaveBeenCalled();
    expect(editor.value).toBe("Task title");
  });

  test("syncs from external value updates when unfocused", () => {
    const { rerender } = render(
      <TaskTitleEditor value="Initial title" onCommit={vi.fn()} />
    );

    const editor = getEditor();
    expect(editor.value).toBe("Initial title");

    rerender(<TaskTitleEditor value="External title" onCommit={vi.fn()} />);

    expect(editor.value).toBe("External title");
  });

  test("does not clobber local draft when external value changes while focused", () => {
    const { rerender } = render(
      <TaskTitleEditor value="Initial title" onCommit={vi.fn()} />
    );

    const editor = getEditor();
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: "Local draft" } });

    rerender(<TaskTitleEditor value="External title" onCommit={vi.fn()} />);

    expect(editor.value).toBe("Local draft");
  });

  test("leaves sizing to CSS so a width change re-wraps without a stale height", () => {
    render(<TaskTitleEditor value="Task title" onCommit={vi.fn()} />);
    const editor = getEditor();

    Object.defineProperty(editor, "scrollHeight", {
      configurable: true,
      get: () => 24,
    });
    fireEvent.input(editor);

    // A JS-measured inline height freezes at the width it was measured on, so
    // the next re-wrap gets cropped (OS-1874).
    expect(editor.style.height).toBe("");
    expect(editor.className).toContain("field-sizing-content");
    expect(editor.className).toContain("min-h-10");
    expect(editor.className).toContain("max-h-40");
  });

  test("textarea is disabled when disabled prop is true", () => {
    render(<TaskTitleEditor value="Title" onCommit={vi.fn()} disabled />);
    expect(getEditor()).toHaveProperty("disabled", true);
  });

  test("applies the closed-task title styling when isClosed is true", () => {
    render(<TaskTitleEditor value="Title" onCommit={vi.fn()} isClosed />);

    const editor = getEditor();
    expect(editor.className).toContain("text-muted-foreground");
    expect(editor.className).toContain("line-through");
  });

  test("keeps the open-task title styling when isClosed is false", () => {
    render(<TaskTitleEditor value="Title" onCommit={vi.fn()} isClosed={false} />);

    const editor = getEditor();
    expect(editor.className).toContain("text-foreground");
    expect(editor.className).not.toContain("line-through");
  });

  describe("readOnly", () => {
    test("a live rename while focused is not committed back on blur", () => {
      const onCommit = vi.fn();
      const { rerender } = render(<TaskTitleEditor value="Old title" onCommit={onCommit} readOnly />);

      fireEvent.focus(getEditor());
      rerender(<TaskTitleEditor value="New title" onCommit={onCommit} readOnly />);
      expect(getEditor().value).toBe("New title");
      fireEvent.blur(getEditor());

      expect(onCommit).not.toHaveBeenCalled();
    });

    test("a draft left open when the role drops to read-only is discarded", () => {
      const onCommit = vi.fn();
      const { rerender } = render(<TaskTitleEditor value="Title" onCommit={onCommit} />);

      fireEvent.focus(getEditor());
      fireEvent.change(getEditor(), { target: { value: "Unsaved draft" } });
      rerender(<TaskTitleEditor value="Title" onCommit={onCommit} readOnly />);
      fireEvent.blur(getEditor());

      expect(onCommit).not.toHaveBeenCalled();
      expect(getEditor().value).toBe("Title");
    });
  });
});
