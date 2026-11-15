/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createRef } from "react";
import {
  MIN_NAME_COLUMN_WIDTH,
  useNameColumnResize,
} from "./use-name-column-resize";

const STORAGE_KEY = "task-table:name-col-width:default";

function setup() {
  // parentRef is only read during a pointer drag; the sizing-state logic under
  // test (cycle / reset / persistence / restore) never touches it.
  const ref = createRef<HTMLDivElement>();
  return renderHook(() => useNameColumnResize(ref));
}

describe("useNameColumnResize", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  describe("initial state from storage", () => {
    test("defaults to auto (null) when nothing is stored", () => {
      const { result } = setup();
      expect(result.current.nameWidth).toBeNull();
      expect(result.current.isAutoWidth).toBe(true);
    });

    test("restores a stored fixed width", () => {
      const stored = MIN_NAME_COLUMN_WIDTH + 200;
      window.localStorage.setItem(STORAGE_KEY, String(stored));
      const { result } = setup();
      expect(result.current.nameWidth).toBe(stored);
      expect(result.current.isAutoWidth).toBe(false);
    });

    test("clamps a stored sub-minimum width up to the minimum", () => {
      window.localStorage.setItem(STORAGE_KEY, "100");
      const { result } = setup();
      expect(result.current.nameWidth).toBe(MIN_NAME_COLUMN_WIDTH);
    });

    test("falls back to auto for a non-numeric stored value", () => {
      window.localStorage.setItem(STORAGE_KEY, "not-a-number");
      const { result } = setup();
      expect(result.current.nameWidth).toBeNull();
    });
  });

  describe("cycleWidth (double-click)", () => {
    test("auto → smallest fixed width, and persists it", () => {
      const { result } = setup();
      act(() => result.current.cycleWidth());
      expect(result.current.nameWidth).toBe(MIN_NAME_COLUMN_WIDTH);
      expect(result.current.isAutoWidth).toBe(false);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
        String(MIN_NAME_COLUMN_WIDTH)
      );
    });

    test("a larger fixed width → smallest fixed width", () => {
      window.localStorage.setItem(STORAGE_KEY, String(MIN_NAME_COLUMN_WIDTH + 300));
      const { result } = setup();
      act(() => result.current.cycleWidth());
      expect(result.current.nameWidth).toBe(MIN_NAME_COLUMN_WIDTH);
    });

    test("smallest fixed width → auto, and clears persistence", () => {
      window.localStorage.setItem(STORAGE_KEY, String(MIN_NAME_COLUMN_WIDTH));
      const { result } = setup();
      act(() => result.current.cycleWidth());
      expect(result.current.nameWidth).toBeNull();
      expect(result.current.isAutoWidth).toBe(true);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    test("cycles auto → smallest → auto across repeated calls", () => {
      const { result } = setup();
      act(() => result.current.cycleWidth());
      expect(result.current.nameWidth).toBe(MIN_NAME_COLUMN_WIDTH);
      act(() => result.current.cycleWidth());
      expect(result.current.nameWidth).toBeNull();
      act(() => result.current.cycleWidth());
      expect(result.current.nameWidth).toBe(MIN_NAME_COLUMN_WIDTH);
    });
  });

  describe("resetToAuto", () => {
    test("clears a fixed width back to auto and removes persistence", () => {
      window.localStorage.setItem(STORAGE_KEY, String(MIN_NAME_COLUMN_WIDTH + 100));
      const { result } = setup();
      expect(result.current.isAutoWidth).toBe(false);

      act(() => result.current.resetToAuto());
      expect(result.current.nameWidth).toBeNull();
      expect(result.current.isAutoWidth).toBe(true);
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    test("is a no-op when already in auto mode", () => {
      const { result } = setup();
      act(() => result.current.resetToAuto());
      expect(result.current.nameWidth).toBeNull();
      expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });
});
