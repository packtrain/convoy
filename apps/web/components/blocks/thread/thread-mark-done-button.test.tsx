/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ThreadMarkDoneButton } from "./thread-mark-done-button";

const onToggle = vi.fn();

function renderButton({ isDone = false }: { isDone?: boolean } = {}) {
  return render(<ThreadMarkDoneButton isDone={isDone} onToggle={onToggle} />);
}

describe("ThreadMarkDoneButton", () => {
  afterEach(() => {
    cleanup();
    onToggle.mockReset();
  });

  test("hands the toggle to its owner, in both directions", () => {
    renderButton({ isDone: false });
    fireEvent.click(screen.getByText("Mark as done"));
    cleanup();

    renderButton({ isDone: true });
    fireEvent.click(screen.getByText("Mark as not done"));

    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  // Takes no run status: the mark is sticky, so it applies mid-run (OS-2176).
  test("is always enabled", () => {
    renderButton();

    expect(
      screen.getByRole("button", { name: "Mark as done" })
    ).toHaveProperty("disabled", false);
  });
});
