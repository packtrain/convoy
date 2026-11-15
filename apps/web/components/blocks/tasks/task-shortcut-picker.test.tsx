/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createDefaultTask } from "@/lib/tasks/defaults";
import type { Id } from "@/convex/_generated/dataModel";
import { Priority, type Task } from "@/lib/tasks/types";
import { TaskShortcutPicker } from "./task-shortcut-picker";

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

vi.mock("@/lib/tasks/hooks/use-project-labels", () => ({
  useProjectLabels: () => ({
    labels: [{ _id: "label-1", name: "Frontend", color: "#3b82f6", rank: "a0" }],
    labelsById: new Map(),
    isLoading: false,
  }),
}));

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    ...createDefaultTask({ name: `Task ${id}` }),
    _id: id as Id<"tasks">,
    clientId: `client-${id}`,
    ...overrides,
  };
}

function renderPicker(property: "priority" | "label" | "dueDate", tasks: Task[]) {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const onTaskUpdate = vi.fn();
  const onClose = vi.fn();
  render(
    <TaskShortcutPicker
      request={{ property, tasks, anchor }}
      onTaskUpdate={onTaskUpdate}
      onClose={onClose}
    />
  );
  return { anchor, onTaskUpdate, onClose };
}

describe("TaskShortcutPicker", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  test("opens the priority picker with the task's value checked", async () => {
    renderPicker("priority", [makeTask("a", { priority: Priority.HIGH })]);

    const input = await screen.findByPlaceholderText("Search priorities...");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.getByRole("button", { name: /High/ }).getAttribute("data-checked")).toBe("true");
  });

  test("applies the chosen priority to every target task, then closes", async () => {
    const { onTaskUpdate, onClose } = renderPicker("priority", [makeTask("a"), makeTask("b")]);

    fireEvent.click(await screen.findByRole("button", { name: /Urgent|Critical/ }));

    expect(onTaskUpdate).toHaveBeenCalledWith("a", { priority: expect.any(String) });
    expect(onTaskUpdate).toHaveBeenCalledWith("b", { priority: expect.any(String) });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test("sets the label from the label picker", async () => {
    const { onTaskUpdate } = renderPicker("label", [makeTask("a")]);

    fireEvent.click(await screen.findByRole("button", { name: /Frontend/ }));

    expect(onTaskUpdate).toHaveBeenCalledWith("a", { labelId: "label-1" });
  });

  test("Escape closes the picker", async () => {
    const { onClose } = renderPicker("priority", [makeTask("a")]);
    const input = await screen.findByPlaceholderText("Search priorities...");

    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  test("opens a calendar for the due date", async () => {
    renderPicker("dueDate", [makeTask("a")]);

    expect(await screen.findByRole("grid")).toBeTruthy();
  });
});
