/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test } from "vitest";
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { useThreadListCollapseState } from "./thread-list-collapse-context";

describe("useThreadListCollapseState", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  test("[ toggles the list and persists it", () => {
    const { result } = renderHook(() => useThreadListCollapseState());
    expect(result.current.collapsed).toBe(false);

    act(() => {
      fireEvent.keyDown(document, { key: "[", code: "BracketLeft" });
    });

    expect(result.current.collapsed).toBe(true);
    expect(localStorage.getItem("thread-list-collapsed")).toBe("true");
  });

  test("[ matches by physical key, so non-US layouts toggle too", () => {
    const { result } = renderHook(() => useThreadListCollapseState());

    act(() => {
      // Ukrainian layout: the [ key types "х".
      fireEvent.keyDown(document, { key: "х", code: "BracketLeft" });
    });

    expect(result.current.collapsed).toBe(true);
  });
});
