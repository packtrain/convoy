/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TaskTagsEditor } from "./task-tags-editor";

describe("TaskTagsEditor", () => {
  afterEach(() => {
    cleanup();
  });

  test("adds a tag on Enter", () => {
    const onTagsChange = vi.fn();

    render(<TaskTagsEditor tags={[]} onTagsChange={onTagsChange} />);

    const input = screen.getByLabelText("Task tags");
    fireEvent.change(input, { target: { value: "release" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onTagsChange).toHaveBeenCalledWith(["release"]);
  });

  test("adds a tag on comma without keeping surrounding whitespace", () => {
    const onTagsChange = vi.fn();

    render(<TaskTagsEditor tags={[]} onTagsChange={onTagsChange} />);

    const input = screen.getByLabelText("Task tags");
    fireEvent.change(input, { target: { value: "  backend  " } });
    fireEvent.keyDown(input, { key: "," });

    expect(onTagsChange).toHaveBeenCalledWith(["backend"]);
  });

  test("prevents case-insensitive duplicates", () => {
    const onTagsChange = vi.fn();

    render(<TaskTagsEditor tags={["Backend"]} onTagsChange={onTagsChange} />);

    const input = screen.getByLabelText("Task tags");
    fireEvent.change(input, { target: { value: "backend" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onTagsChange).not.toHaveBeenCalled();
  });

  test("removes a tag from its remove button", () => {
    const onTagsChange = vi.fn();

    render(
      <TaskTagsEditor tags={["backend", "release"]} onTagsChange={onTagsChange} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove backend tag" }));

    expect(onTagsChange).toHaveBeenCalledWith(["release"]);
  });

  test("removes the last tag on Backspace when the input is empty", () => {
    const onTagsChange = vi.fn();

    render(
      <TaskTagsEditor tags={["backend", "release"]} onTagsChange={onTagsChange} />
    );

    const input = screen.getByLabelText("Task tags");
    fireEvent.keyDown(input, { key: "Backspace" });

    expect(onTagsChange).toHaveBeenCalledWith(["backend"]);
  });

  test("read-only shows the tags with no input or remove buttons", () => {
    render(<TaskTagsEditor tags={["release", "ui"]} onTagsChange={vi.fn()} readOnly />);

    expect(screen.getByText("release")).toBeTruthy();
    expect(screen.getByText("ui")).toBeTruthy();
    expect(screen.queryByLabelText("Task tags")).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  test("a chip focused before the role drops to read-only cannot delete its tag", () => {
    const onTagsChange = vi.fn();
    const { rerender } = render(
      <TaskTagsEditor tags={["release", "ui"]} onTagsChange={onTagsChange} />
    );

    const input = screen.getByLabelText("Task tags");
    input.focus();
    fireEvent.keyDown(input, { key: "ArrowLeft" });
    rerender(<TaskTagsEditor tags={["release", "ui"]} onTagsChange={onTagsChange} readOnly />);
    const focused = document.activeElement as HTMLElement;
    expect(focused.textContent).toContain("ui");
    fireEvent.keyDown(focused, { key: "Delete" });
    fireEvent.keyDown(focused, { key: "Backspace" });

    expect(onTagsChange).not.toHaveBeenCalled();
  });
});
