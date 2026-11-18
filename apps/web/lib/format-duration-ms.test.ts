import { describe, expect, it } from "vitest";
import { formatDurationMs } from "./format-duration-ms";

describe("formatDurationMs", () => {
  it.each([
    [undefined, null],
    [450, "450ms"],
    [4_200, "4.2s"],
    [59_900, "59.9s"],
    [59_960, "1m"],
    [60_000, "1m"],
    [316_000, "5m 16s"],
    [3_600_000, "1h"],
    [3_725_000, "1h 2m 5s"],
  ])("formats %s as %s", (input, expected) => {
    expect(formatDurationMs(input)).toBe(expected);
  });
});
