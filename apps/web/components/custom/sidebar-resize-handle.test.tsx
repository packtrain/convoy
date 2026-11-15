/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { SidebarResizeHandle } from "./sidebar-resize-handle";

describe("SidebarResizeHandle", () => {
  afterEach(() => {
    cleanup();
  });

  test("renders separator accessibility metadata", () => {
    render(
      <SidebarResizeHandle
        ariaLabel="Resize something"
        currentWidth={420}
        bounds={{ min: 300, max: 900 }}
        expandDirection="left"
        onResizeMouseDown={vi.fn()}
        onResizeByStep={vi.fn()}
      />
    );

    const handle = screen.getByRole("separator", {
      name: "Resize something",
    });

    expect(handle.getAttribute("aria-valuemin")).toBe("300");
    expect(handle.getAttribute("aria-valuemax")).toBe("900");
    expect(handle.getAttribute("aria-valuenow")).toBe("420");
  });

  test("uses left edge semantics when expanding left-anchored sidebars", () => {
    const onResizeByStep = vi.fn();

    render(
      <SidebarResizeHandle
        ariaLabel="Resize left"
        currentWidth={420}
        bounds={{ min: 300, max: 900 }}
        expandDirection="left"
        onResizeMouseDown={vi.fn()}
        onResizeByStep={onResizeByStep}
      />
    );

    const handle = screen.getByRole("separator", { name: "Resize left" });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    fireEvent.keyDown(handle, { key: "ArrowRight", shiftKey: true });

    expect(onResizeByStep).toHaveBeenNthCalledWith(1, 16, { persist: true });
    expect(onResizeByStep).toHaveBeenNthCalledWith(2, -48, { persist: true });
  });

  test("uses right edge semantics when expanding right-anchored sidebars", () => {
    const onResizeByStep = vi.fn();

    render(
      <SidebarResizeHandle
        ariaLabel="Resize right"
        currentWidth={320}
        bounds={{ min: 256, max: 640 }}
        expandDirection="right"
        onResizeMouseDown={vi.fn()}
        onResizeByStep={onResizeByStep}
      />
    );

    const handle = screen.getByRole("separator", { name: "Resize right" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });

    expect(onResizeByStep).toHaveBeenNthCalledWith(1, 16, { persist: true });
    expect(onResizeByStep).toHaveBeenNthCalledWith(2, -48, { persist: true });
  });
});
