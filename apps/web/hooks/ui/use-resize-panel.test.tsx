/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { RESIZE_BOUNDS } from "@/lib/tasks/constants";
import { useResizePanel } from "./use-resize-panel";

const LEFT_BOUNDS = {
  min: 256,
  max: 640,
  default: 320,
  storageKey: "thread-sidebar-width.test",
} as const;

describe("useResizePanel", () => {
  test("keyboard-style adjustments clamp width to bounds and persist", () => {
    localStorage.removeItem(RESIZE_BOUNDS.storageKey);
    const containerRef = { current: document.createElement("div") };

    const { result } = renderHook(() =>
      useResizePanel(containerRef, { bounds: RESIZE_BOUNDS })
    );

    act(() => {
      result.current.setWidth(RESIZE_BOUNDS.default);
    });

    act(() => {
      result.current.adjustWidthBy(10_000, { persist: true });
    });
    expect(result.current.width).toBe(RESIZE_BOUNDS.max);
    expect(localStorage.getItem(RESIZE_BOUNDS.storageKey)).toBe(String(RESIZE_BOUNDS.max));

    act(() => {
      result.current.adjustWidthBy(-10_000, { persist: true });
    });
    expect(result.current.width).toBe(RESIZE_BOUNDS.min);
    expect(localStorage.getItem(RESIZE_BOUNDS.storageKey)).toBe(String(RESIZE_BOUNDS.min));
  });

  test("persists width on mouse resize end", () => {
    localStorage.removeItem(RESIZE_BOUNDS.storageKey);
    const container = document.createElement("div");
    const containerRef = { current: container };
    vi.spyOn(container, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 1000,
          bottom: 800,
          width: 1000,
          height: 800,
          toJSON: () => ({}),
        }) as DOMRect
    );

    const { result } = renderHook(() =>
      useResizePanel(containerRef, { bounds: RESIZE_BOUNDS })
    );

    act(() => {
      result.current.handleMouseDown();
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 720 }));
    });
    expect(result.current.width).toBe(RESIZE_BOUNDS.min);

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(localStorage.getItem(RESIZE_BOUNDS.storageKey)).toBe(String(RESIZE_BOUNDS.min));
  });

  test("deferred mode previews during drag and commits + persists on mouse up", () => {
    const DEFERRED_BOUNDS = {
      ...RESIZE_BOUNDS,
      storageKey: "task-sidebar-width.deferred-test",
    } as const;
    localStorage.removeItem(DEFERRED_BOUNDS.storageKey);
    const container = document.createElement("div");
    const containerRef = { current: container };
    vi.spyOn(container, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          right: 1000,
          bottom: 800,
          width: 1000,
          height: 800,
          toJSON: () => ({}),
        }) as DOMRect
    );

    const { result } = renderHook(() =>
      useResizePanel(containerRef, {
        bounds: DEFERRED_BOUNDS,
        deferCommit: true,
      })
    );

    expect(result.current.width).toBe(DEFERRED_BOUNDS.default);

    act(() => {
      result.current.handleMouseDown();
    });
    expect(result.current.isResizing).toBe(true);

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 480 }));
    });
    // Width is untouched mid-drag; only the preview tracks the pointer.
    expect(result.current.width).toBe(DEFERRED_BOUNDS.default);
    expect(result.current.previewWidth).toBe(520);
    expect(localStorage.getItem(DEFERRED_BOUNDS.storageKey)).toBeNull();

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(result.current.width).toBe(520);
    expect(result.current.previewWidth).toBeNull();
    expect(result.current.isResizing).toBe(false);
    expect(localStorage.getItem(DEFERRED_BOUNDS.storageKey)).toBe("520");
  });

  test("deferred mode treats a press without movement as a click (no commit)", () => {
    const DEFERRED_BOUNDS = {
      ...RESIZE_BOUNDS,
      storageKey: "task-sidebar-width.deferred-click-test",
    } as const;
    localStorage.removeItem(DEFERRED_BOUNDS.storageKey);
    const containerRef = { current: document.createElement("div") };

    const { result } = renderHook(() =>
      useResizePanel(containerRef, {
        bounds: DEFERRED_BOUNDS,
        deferCommit: true,
      })
    );

    act(() => {
      result.current.handleMouseDown();
    });
    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });

    expect(result.current.width).toBe(DEFERRED_BOUNDS.default);
    expect(localStorage.getItem(DEFERRED_BOUNDS.storageKey)).toBeNull();
  });

  test("supports left-anchored panels with custom bounds and storage", () => {
    localStorage.setItem(LEFT_BOUNDS.storageKey, "500");
    const container = document.createElement("div");
    const containerRef = { current: container };
    vi.spyOn(container, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 100,
          y: 0,
          left: 100,
          top: 0,
          right: 1100,
          bottom: 800,
          width: 1000,
          height: 800,
          toJSON: () => ({}),
        }) as DOMRect
    );

    const { result } = renderHook(() =>
      useResizePanel(containerRef, {
        bounds: LEFT_BOUNDS,
        getWidthFromPointer: ({ clientX, containerRect }) =>
          clientX - containerRect.left,
      })
    );

    expect(result.current.width).toBe(500);

    act(() => {
      result.current.handleMouseDown();
    });

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 920 }));
    });
    expect(result.current.width).toBe(LEFT_BOUNDS.max);

    act(() => {
      document.dispatchEvent(new MouseEvent("mousemove", { clientX: 120 }));
    });
    expect(result.current.width).toBe(LEFT_BOUNDS.min);

    act(() => {
      document.dispatchEvent(new MouseEvent("mouseup"));
    });
    expect(localStorage.getItem(LEFT_BOUNDS.storageKey)).toBe(
      String(LEFT_BOUNDS.min)
    );
  });
});
