// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { useIsMobile } from "./use-mobile";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

test("desktop consumers do not rerender after mounting", () => {
  vi.stubGlobal("innerWidth", 1440);
  vi.stubGlobal("matchMedia", vi.fn(() => ({
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })));
  const snapshots: boolean[] = [];
  renderHook(() => { snapshots.push(useIsMobile()); });
  expect(snapshots).toEqual([false]);
});

test("the resize fallback still switches between mobile and desktop", () => {
  vi.stubGlobal("matchMedia", undefined);
  vi.stubGlobal("innerWidth", 400);
  const { result } = renderHook(() => useIsMobile());
  expect(result.current).toBe(true);
  act(() => { window.innerWidth = 1200; window.dispatchEvent(new Event("resize")); });
  expect(result.current).toBe(false);
});
