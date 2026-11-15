/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { NameCellInput } from "./name-cell";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NameCellInput", () => {
  test("restores focus when the focused task input is remounted", () => {
    const inputRefs = { current: new Map<string, HTMLInputElement>() };
    const baseProps = {
      value: "abcdef",
      taskId: "task-1",
      isClosed: false,
      inputRefs,
      onSave: vi.fn(),
      onDelete: vi.fn(),
      onKeyDown: vi.fn(),
    };

    const { rerender } = render(
      <NameCellInput key="before" {...baseProps} />
    );
    const focusedInput = screen.getByRole("textbox") as HTMLInputElement;
    focusedInput.focus();
    focusedInput.setSelectionRange(2, 5);

    expect(document.activeElement).toBe(focusedInput);

    rerender(<NameCellInput key="after" {...baseProps} />);

    const remountedInput = screen.getByRole("textbox") as HTMLInputElement;
    expect(remountedInput).not.toBe(focusedInput);
    expect(document.activeElement).toBe(remountedInput);
    expect(remountedInput.selectionStart).toBe(2);
    expect(remountedInput.selectionEnd).toBe(5);
  });

  function setWidths(element: HTMLElement, scrollWidth: number, clientWidth: number) {
    Object.defineProperty(element, "scrollWidth", { configurable: true, value: scrollWidth });
    Object.defineProperty(element, "clientWidth", { configurable: true, value: clientWidth });
  }

  const props = {
    value: "A long task title that does not fit",
    taskId: "task-1",
    isClosed: false,
    inputRefs: { current: new Map<string, HTMLInputElement>() },
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onKeyDown: vi.fn(),
  };

  test("a truncated title shows the full title on hover", () => {
    render(<NameCellInput {...props} />);
    const input = screen.getByRole("textbox");
    setWidths(input, 400, 120);
    fireEvent.pointerEnter(input);
    expect(input.getAttribute("title")).toBe(props.value);
  });

  test("a title that fits gets no tooltip", () => {
    render(<NameCellInput {...props} />);
    const input = screen.getByRole("textbox");
    setWidths(input, 120, 120);
    fireEvent.pointerEnter(input);
    expect(input.hasAttribute("title")).toBe(false);
  });

  test("a truncated read-only title shows the full title on hover", () => {
    render(<NameCellInput {...props} isEditable={false} />);
    const text = screen.getByText(props.value);
    setWidths(text, 400, 120);
    fireEvent.pointerEnter(text);
    expect(text.getAttribute("title")).toBe(props.value);
  });
});
