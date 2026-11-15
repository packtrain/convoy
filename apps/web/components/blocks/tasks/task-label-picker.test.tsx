/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Id } from "@/convex/_generated/dataModel";
import { TaskLabelPicker } from "./task-label-picker";

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

vi.mock("@/components/blocks/tasks/create-task-label-dialog", () => ({
  CreateTaskLabelDialog: () => null,
}));

const labels = [
  { _id: "label_1" as Id<"projectLabels">, name: "Q1", color: "#ef4444", rank: "0|a" },
];

describe("TaskLabelPicker", () => {
  afterEach(cleanup);

  test("opens in the same dropdown menu container as the other property pickers", async () => {
    render(
      <TaskLabelPicker
        labels={labels}
        value={null}
        onChange={vi.fn()}
        trigger={<button type="button">Open label</button>}
      />
    );
    const trigger = screen.getByRole("button", { name: "Open label" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);

    const input = await screen.findByPlaceholderText("Search labels...");
    expect(input.closest('[data-slot="dropdown-menu-content"]')).not.toBeNull();
  });

  test("a controlled open prop opens the picker without a click", async () => {
    const onChange = vi.fn();
    render(
      <TaskLabelPicker
        open
        onOpenChange={vi.fn()}
        labels={labels}
        value={null}
        onChange={onChange}
        trigger={<button type="button">Open label</button>}
      />
    );
    fireEvent.click(await screen.findByRole("button", { name: /Q1/ }));
    expect(onChange).toHaveBeenCalledWith("label_1");
  });
});
