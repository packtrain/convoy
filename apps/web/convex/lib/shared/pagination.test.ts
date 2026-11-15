import { describe, expect, test } from "vitest";
import { clampPageSize } from "./pagination";

describe("clampPageSize", () => {
  const bounds = { min: 1, max: 20, default: 10 };

  test("passes an in-range limit through", () => {
    expect(clampPageSize(5, bounds)).toBe(5);
  });

  test("uses the default when absent", () => {
    expect(clampPageSize(undefined, bounds)).toBe(10);
  });

  test("floors and ceilings an out-of-range limit rather than rejecting it", () => {
    expect(clampPageSize(0, bounds)).toBe(1);
    expect(clampPageSize(-3, bounds)).toBe(1);
    expect(clampPageSize(100, bounds)).toBe(20);
  });

  test("floors a non-integer", () => {
    // A CLI parsing `--limit` from argv is the realistic source.
    expect(clampPageSize(2.5, bounds)).toBe(2);
    expect(clampPageSize(0.5, bounds)).toBe(1);
    expect(clampPageSize(19.9, bounds)).toBe(19);
  });

  test("treats NaN and infinities as no preference expressed", () => {
    // NaN survives Math.min/Math.max, so it would otherwise reach `.take()`.
    expect(clampPageSize(Number.NaN, bounds)).toBe(10);
    expect(clampPageSize(Number.POSITIVE_INFINITY, bounds)).toBe(10);
    expect(clampPageSize(Number.NEGATIVE_INFINITY, bounds)).toBe(10);
  });
});
