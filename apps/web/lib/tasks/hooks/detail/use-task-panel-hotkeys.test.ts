/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useTaskPanelHotkeys } from "./use-task-panel-hotkeys";

function press(key: string, target: Element = document.body, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function setup(overrides: Partial<Parameters<typeof useTaskPanelHotkeys>[0]> = {}) {
  const onOpenTask = vi.fn();
  const onClose = vi.fn();
  renderHook(() =>
    useTaskPanelHotkeys({
      isOpen: true,
      currentTaskId: "b",
      getTaskOrder: () => ["a", "b", "c"],
      onOpenTask,
      onClose,
      ...overrides,
    })
  );
  return { onOpenTask, onClose };
}

describe("useTaskPanelHotkeys", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  test("J and K open the next and previous task in view order", () => {
    const { onOpenTask } = setup();

    expect(press("j").defaultPrevented).toBe(true);
    expect(onOpenTask).toHaveBeenLastCalledWith("c");
    press("k");
    expect(onOpenTask).toHaveBeenLastCalledWith("a");
  });

  test("stops at the ends of the list and ignores tasks outside it", () => {
    const atEnd = setup({ currentTaskId: "c" });
    expect(press("j").defaultPrevented).toBe(false);
    expect(atEnd.onOpenTask).not.toHaveBeenCalled();
    cleanup();

    const subtask = setup({ currentTaskId: "child" });
    press("k");
    expect(subtask.onOpenTask).not.toHaveBeenCalled();
  });

  test("Escape closes the panel", () => {
    const { onClose } = setup();

    expect(press("Escape").defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("does nothing while closed", () => {
    const { onClose, onOpenTask } = setup({ isOpen: false });

    press("Escape");
    press("j");
    expect(onClose).not.toHaveBeenCalled();
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  test("ignores keys typed in inputs and the editor", () => {
    const { onClose, onOpenTask } = setup();
    const input = document.body.appendChild(document.createElement("input"));
    const editor = document.body.appendChild(document.createElement("div"));
    editor.setAttribute("contenteditable", "true");

    for (const target of [input, editor]) {
      press("Escape", target);
      press("j", target);
    }
    expect(onClose).not.toHaveBeenCalled();
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  test("leaves keys another handler already claimed, and modified keys", () => {
    const { onClose, onOpenTask } = setup();
    const claim = (event: KeyboardEvent) => event.preventDefault();
    document.addEventListener("keydown", claim);

    press("Escape");
    press("j");
    document.removeEventListener("keydown", claim);
    press("j", document.body, { metaKey: true });
    press("K", document.body, { shiftKey: true });

    expect(onClose).not.toHaveBeenCalled();
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  test("ignores keys inside a dialog or menu layered over the panel", () => {
    const { onClose, onOpenTask } = setup();
    const dialog = document.body.appendChild(document.createElement("div"));
    dialog.setAttribute("role", "alertdialog");
    const button = dialog.appendChild(document.createElement("button"));

    press("Escape", button);
    press("j", button);
    expect(onClose).not.toHaveBeenCalled();
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  test("still handles keys inside the panel's own mobile drawer", () => {
    const { onOpenTask } = setup();
    const drawer = document.body.appendChild(document.createElement("div"));
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("data-task-panel", "");
    const button = drawer.appendChild(document.createElement("button"));

    press("j", button);
    expect(onOpenTask).toHaveBeenCalledWith("c");
  });
});
