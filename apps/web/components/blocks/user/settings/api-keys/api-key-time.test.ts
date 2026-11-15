import { describe, expect, test } from "vitest";
import { formatCompactRelativeTime } from "./api-key-time";

describe("formatCompactRelativeTime", () => {
  test("uses short text for very recent timestamps", () => {
    const now = new Date("2026-05-29T12:00:00.000Z").getTime();
    const lastUsedAt = now - 30_000;

    expect(formatCompactRelativeTime(lastUsedAt, now)).toBe("<1m ago");
  });

  test("uses compact units for older timestamps", () => {
    const now = new Date("2026-05-29T12:00:00.000Z").getTime();

    expect(formatCompactRelativeTime(now - 2 * 60_000, now)).toBe("2m ago");
    expect(formatCompactRelativeTime(now - 3 * 60 * 60_000, now)).toBe("3h ago");
    expect(formatCompactRelativeTime(now - 4 * 24 * 60 * 60_000, now)).toBe(
      "4d ago"
    );
  });
});
