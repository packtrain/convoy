/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { readSectionCollapsed, writeSectionCollapsed } from "./section-collapsed";

const KEY = "convoy.test-section-collapsed";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("readSectionCollapsed", () => {
  test("returns the fallback when the key is unset", () => {
    expect(readSectionCollapsed(KEY, true)).toBe(true);
    expect(readSectionCollapsed(KEY, false)).toBe(false);
  });

  test('stored "1" reads as collapsed regardless of fallback', () => {
    window.localStorage.setItem(KEY, "1");
    expect(readSectionCollapsed(KEY, false)).toBe(true);
  });

  test('stored "0" reads as expanded even when the fallback is collapsed', () => {
    window.localStorage.setItem(KEY, "0");
    expect(readSectionCollapsed(KEY, true)).toBe(false);
  });

  test("falls back when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readSectionCollapsed(KEY, true)).toBe(true);
    expect(readSectionCollapsed(KEY, false)).toBe(false);
  });
});

describe("writeSectionCollapsed", () => {
  test("round-trips through readSectionCollapsed", () => {
    writeSectionCollapsed(KEY, true);
    expect(readSectionCollapsed(KEY, false)).toBe(true);

    writeSectionCollapsed(KEY, false);
    expect(readSectionCollapsed(KEY, true)).toBe(false);
  });

  test("ignores storage failures", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => writeSectionCollapsed(KEY, true)).not.toThrow();
  });
});
