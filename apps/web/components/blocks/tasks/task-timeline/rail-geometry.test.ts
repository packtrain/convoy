import { describe, expect, test } from "vitest";
import {
  COMPOSER_TRIGGER_RAIL_PADDING_CLASS,
  COMPOSER_TRIGGER_RAIL_PADDING_PX,
  RAIL_CENTER_PX,
  THREAD_CARD_INDICATOR_CENTER_PX,
  THREAD_CARD_RAIL_OFFSET_CLASS,
  THREAD_CARD_RAIL_OFFSET_PX,
} from "./rail-geometry";

/**
 * These assert the Tailwind classes still match the arithmetic they were derived from.
 * jsdom computes no layout, so nothing here measures real alignment — but this catches
 * the drift that happens: a padding change moves the derived pixel value and the
 * hard-coded class stops matching. The class-string assertion this replaces passed
 * happily while the pixels drifted.
 */
describe("timeline rail geometry", () => {
  test("the rail column is where the activity glyphs center", () => {
    // `left-1` (4px) + half of `size-5` (20px).
    expect(RAIL_CENTER_PX).toBe(14);
  });

  test("the thread card's dot sits 3px right of the rail before correction", () => {
    // 1px border + `pl-2` (8px) + half of `size-4` (16px).
    expect(THREAD_CARD_INDICATOR_CENTER_PX).toBe(17);
    expect(THREAD_CARD_RAIL_OFFSET_PX).toBe(3);
  });

  test("the card's offset class matches its derived pixel value", () => {
    expect(THREAD_CARD_RAIL_OFFSET_CLASS).toBe(`-mx-[${THREAD_CARD_RAIL_OFFSET_PX}px]`);
  });

  test("the composer trigger's padding class matches its derived pixel value", () => {
    // 14px rail center − 8px icon center = 6px, and `pl-1.5` is 6px.
    expect(COMPOSER_TRIGGER_RAIL_PADDING_PX).toBe(6);
    expect(COMPOSER_TRIGGER_RAIL_PADDING_CLASS).toBe("pl-1.5");
  });
});
