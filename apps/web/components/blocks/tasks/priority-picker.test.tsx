/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Priority } from "@/lib/tasks/types";
import { PriorityPicker } from "./priority-picker";

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = () => {};
}

function openPicker() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Open priority" }), { button: 0, ctrlKey: false });
}

describe("PriorityPicker", () => {
  afterEach(cleanup);

  test("opens a searchable list that checks the current priority", async () => {
    render(
      <PriorityPicker
        priority={Priority.HIGH}
        onPriorityChange={vi.fn()}
        trigger={<button type="button">Open priority</button>}
      />
    );
    openPicker();

    const input = await screen.findByPlaceholderText("Search priorities...");
    await waitFor(() => expect(document.activeElement).toBe(input));
    const high = screen.getByRole("button", { name: /High/ });
    expect(high.getAttribute("data-checked")).toBe("true");
    expect(screen.getByRole("button", { name: /Low/ }).getAttribute("data-checked")).not.toBe("true");

    fireEvent.change(input, { target: { value: "crit" } });
    expect(screen.getByRole("button", { name: /Critical/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Medium/ })).toBeNull();
  });

  test("selecting a row reports the priority", async () => {
    const onPriorityChange = vi.fn();
    render(
      <PriorityPicker
        priority={Priority.NONE}
        onPriorityChange={onPriorityChange}
        trigger={<button type="button">Open priority</button>}
      />
    );
    openPicker();
    fireEvent.click(await screen.findByRole("button", { name: /Medium/ }));
    expect(onPriorityChange).toHaveBeenCalledWith(Priority.MEDIUM);
  });

  test("a controlled open prop opens the picker without a click", async () => {
    render(
      <PriorityPicker
        open
        onOpenChange={vi.fn()}
        priority={Priority.LOW}
        onPriorityChange={vi.fn()}
        trigger={<button type="button">Open priority</button>}
      />
    );
    expect(await screen.findByPlaceholderText("Search priorities...")).toBeTruthy();
  });
});
