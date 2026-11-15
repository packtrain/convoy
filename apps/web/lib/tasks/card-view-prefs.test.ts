/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import {
  readShowCardDescription,
  useShowCardDescription,
  writeShowCardDescription,
} from "./card-view-prefs";

const KEY = "convoy.task-card-show-description";

afterEach(() => {
  window.localStorage.clear();
});

describe("card description preference", () => {
  test("is off when nothing is stored", () => {
    expect(readShowCardDescription()).toBe(false);
  });

  test("round-trips on and off", () => {
    writeShowCardDescription(true);
    expect(window.localStorage.getItem(KEY)).toBe("1");
    expect(readShowCardDescription()).toBe(true);

    writeShowCardDescription(false);
    expect(readShowCardDescription()).toBe(false);
  });

  test("reads anything but an explicit on as off", () => {
    window.localStorage.setItem(KEY, "yes");
    expect(readShowCardDescription()).toBe(false);
  });

  test("updates every subscribed component when the toggle changes", () => {
    const first = renderHook(() => useShowCardDescription());
    const second = renderHook(() => useShowCardDescription());
    expect(first.result.current[0]).toBe(false);

    act(() => first.result.current[1](true));

    expect(first.result.current[0]).toBe(true);
    expect(second.result.current[0]).toBe(true);
  });
});
