/**
 * @vitest-environment jsdom
 */
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useGoToHotkeys } from "./use-go-to-hotkeys";

function press(key: string, target: Element = document.body, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

function setup() {
  const handlers = {
    inbox: vi.fn(),
    watchTower: vi.fn(),
    threads: vi.fn(),
    settings: vi.fn(),
  };
  renderHook(() => useGoToHotkeys(handlers));
  return handlers;
}

describe("useGoToHotkeys", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  test.each([
    ["i", "inbox"],
    ["w", "watchTower"],
    ["t", "threads"],
    ["s", "settings"],
  ] as const)("G then %s goes to %s", (key, destination) => {
    const handlers = setup();

    press("g");
    press(key);

    expect(handlers[destination]).toHaveBeenCalledTimes(1);
  });

  test("claims the second key so task shortcuts on the same letter do not run", () => {
    setup();
    const documentListener = vi.fn();
    document.addEventListener("keydown", documentListener, { capture: true });

    press("g");
    const second = press("i");
    document.removeEventListener("keydown", documentListener, { capture: true });

    expect(second.defaultPrevented).toBe(true);
    // G itself passes through; only the chord's second key is claimed.
    expect(documentListener).toHaveBeenCalledTimes(1);
  });

  test("a letter without G first, or an unknown second key, does nothing", () => {
    const handlers = setup();

    expect(press("i").defaultPrevented).toBe(false);
    press("g");
    expect(press("x").defaultPrevented).toBe(false);
    press("i");

    expect(handlers.inbox).not.toHaveBeenCalled();
  });

  test("the chord expires", () => {
    vi.useFakeTimers();
    const handlers = setup();

    press("g");
    vi.advanceTimersByTime(2000);
    press("i");

    expect(handlers.inbox).not.toHaveBeenCalled();
  });

  test("ignores keys typed in inputs and the editor", () => {
    const handlers = setup();
    const input = document.body.appendChild(document.createElement("input"));
    const editor = document.body.appendChild(document.createElement("div"));
    editor.setAttribute("contenteditable", "true");

    for (const target of [input, editor]) {
      press("g", target);
      press("i", target);
    }
    press("g", input);
    press("i");

    expect(handlers.inbox).not.toHaveBeenCalled();
  });

  test.each(["dialog", "alertdialog", "menu", "listbox"])("ignores keys while a %s has focus", (role) => {
    const handlers = setup();
    const layer = document.body.appendChild(document.createElement("div"));
    layer.setAttribute("role", role);
    const button = layer.appendChild(document.createElement("button"));

    press("g", button);
    const second = press("i", button);

    expect(second.defaultPrevented).toBe(false);
    expect(handlers.inbox).not.toHaveBeenCalled();
  });

  test("still runs inside the task panel's drawer", () => {
    const handlers = setup();
    const drawer = document.body.appendChild(document.createElement("div"));
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("data-task-panel", "");
    const button = drawer.appendChild(document.createElement("button"));

    press("g", button);
    press("i", button);

    expect(handlers.inbox).toHaveBeenCalledTimes(1);
  });

  test("ignores modified keys", () => {
    const handlers = setup();

    press("g", document.body, { metaKey: true });
    press("i");
    press("g");
    press("i", document.body, { ctrlKey: true });

    expect(handlers.inbox).not.toHaveBeenCalled();
  });
});
