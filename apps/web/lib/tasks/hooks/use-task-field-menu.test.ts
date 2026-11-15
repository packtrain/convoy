/**
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import {
  isTaskFieldDragTarget,
  useTaskFieldMenuTrigger,
} from "./use-task-field-menu";

function pointerDownEvent(
  overrides: Partial<{
    pointerType: string;
    button: number;
    ctrlKey: boolean;
    clientX: number;
    clientY: number;
    timeStamp: number;
  }> = {}
) {
  return {
    pointerType: "mouse",
    button: 0,
    ctrlKey: false,
    clientX: 10,
    clientY: 10,
    timeStamp: 1000,
    defaultPrevented: false,
    nativeEvent: { defaultPrevented: false },
    ...overrides,
  } as unknown as ReactPointerEvent<HTMLElement>;
}

function clickEvent(clientX: number, clientY: number, timeStamp = 1100) {
  return { clientX, clientY, timeStamp } as unknown as ReactMouseEvent<HTMLElement>;
}

describe("useTaskFieldMenuTrigger", () => {
  test("marks only the synthetic event as default-prevented on mouse press", () => {
    const { result } = renderHook(() =>
      useTaskFieldMenuTrigger({ open: false, onOpenChange: vi.fn() })
    );

    const event = pointerDownEvent();
    result.current.onPointerDown(event);

    // Radix skips its pointerdown-open via the synthetic flag; drag sensors
    // read the native event, which must stay unprevented.
    expect(event.defaultPrevented).toBe(true);
    expect(event.nativeEvent.defaultPrevented).toBe(false);
  });

  test("opens on a still click and ignores a click that ended a drag", () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() =>
      useTaskFieldMenuTrigger({ open: false, onOpenChange })
    );

    result.current.onPointerDown(pointerDownEvent());
    result.current.onClick(clickEvent(12, 11));
    expect(onOpenChange).toHaveBeenCalledWith(true);

    onOpenChange.mockClear();
    result.current.onPointerDown(pointerDownEvent());
    result.current.onClick(clickEvent(40, 10));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test("does not reopen when the press dismissed an open menu", () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() =>
      useTaskFieldMenuTrigger({ open: true, onOpenChange })
    );

    result.current.onPointerDown(pointerDownEvent());
    result.current.onClick(clickEvent(10, 10));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test("blocks the instant touch open and opens on a quick tap instead", () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() =>
      useTaskFieldMenuTrigger({ open: false, onOpenChange })
    );

    const touchEvent = pointerDownEvent({ pointerType: "touch" });
    result.current.onPointerDown(touchEvent);
    // Radix must not open the menu on touch pointerdown; the native event
    // stays unprevented so long-press drag systems and scrolling still work.
    expect(touchEvent.defaultPrevented).toBe(true);
    expect(touchEvent.nativeEvent.defaultPrevented).toBe(false);

    result.current.onClick(clickEvent(12, 11, 1200));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  test("does not open from a touch long-press release", () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() =>
      useTaskFieldMenuTrigger({ open: false, onOpenChange })
    );

    result.current.onPointerDown(
      pointerDownEvent({ pointerType: "touch", timeStamp: 1000 })
    );
    // Held past the long-press drag delay without moving: the row/card was
    // lifted, so the release click must not open the menu.
    result.current.onClick(clickEvent(10, 10, 1500));
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test("leaves keyboard clicks to Radix", () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() =>
      useTaskFieldMenuTrigger({ open: false, onOpenChange })
    );

    // Click with no recorded press (keyboard) must not open here.
    result.current.onClick(clickEvent(10, 10));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe("isTaskFieldDragTarget", () => {
  test("matches elements inside a marked trigger only", () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("data-task-field-drag", "");
    const icon = document.createElement("span");
    trigger.appendChild(icon);
    const plainButton = document.createElement("button");

    expect(isTaskFieldDragTarget(trigger)).toBe(true);
    expect(isTaskFieldDragTarget(icon)).toBe(true);
    expect(isTaskFieldDragTarget(plainButton)).toBe(false);
    expect(isTaskFieldDragTarget(null)).toBe(false);
  });
});
