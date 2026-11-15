import { describe, expect, test } from "vitest";
import { computeVisibleTabCount } from "./tab-overflow";

const cut = (widths: number[], available: number, activeIndex = -1) =>
  computeVisibleTabCount({ widths, available, activeIndex });

describe("computeVisibleTabCount", () => {
  test("keeps every tab when they fit, and while widths are unmeasured", () => {
    expect(cut([100, 100], 200)).toBe(2);
    expect(cut([0, 0, 0], 0)).toBe(3);
  });

  test("cuts the tail that does not fit", () => {
    expect(cut([100, 100, 100], 250)).toBe(2);
  });

  test("reserves the active tab's width when it is cut, so it can take the slot", () => {
    // Active is the last tab: 250 - 100 fits only one leading tab.
    expect(cut([100, 100, 100], 250, 2)).toBe(1);
    // Active still visible: no slot to reserve.
    expect(cut([100, 100, 100], 250, 0)).toBe(2);
  });

  test("keeps one tab even when it does not fit — it hosts the dropdown", () => {
    expect(cut([500, 100], 200)).toBe(1);
    // Unless the active tab took the slot: it hosts the trigger there.
    expect(cut([500, 100], 200, 1)).toBe(0);
  });
});
