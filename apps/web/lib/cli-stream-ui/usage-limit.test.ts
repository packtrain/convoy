import { describe, expect, test } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import type { CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import type { NormalizedChunkRow } from "./types";
import {
  deriveLatestUsageLimits,
  formatUsageLimitPercentage,
  formatUsageLimitReset,
  formatUsageLimitWindowLabel,
  getUsageLimitSeverity,
  mergeUsageLimits,
} from "./usage-limit";

function makeRow(chunkOrder: number, event: CliNormalizedEvent): NormalizedChunkRow {
  return {
    messageId: "msg-1" as Id<"cliMessages">,
    threadId: "thread-1" as Id<"cliThreads">,
    createdAt: 1000 + chunkOrder,
    chunkOrder,
    timestamp: 1000 + chunkOrder,
    event,
  };
}

describe("getUsageLimitSeverity", () => {
  test("tiers by utilization thresholds", () => {
    expect(getUsageLimitSeverity({ utilization: 0.5 })).toBe("none");
    expect(getUsageLimitSeverity({ utilization: 0.8 })).toBe("warning");
    expect(getUsageLimitSeverity({ utilization: 0.94 })).toBe("warning");
    expect(getUsageLimitSeverity({ utilization: 0.95 })).toBe("critical");
    expect(getUsageLimitSeverity({ utilization: 1 })).toBe("critical");
  });

  test("overage is always critical; missing utilization is none", () => {
    expect(getUsageLimitSeverity({ utilization: 0.1, isUsingOverage: true })).toBe(
      "critical"
    );
    expect(getUsageLimitSeverity({})).toBe("none");
  });
});

describe("deriveLatestUsageLimits", () => {
  test("keeps only the latest snapshot per window", () => {
    const rows = [
      makeRow(0, { kind: "usage-limit", window: "5h", utilization: 0.5 }),
      makeRow(1, { kind: "usage-limit", window: "weekly", utilization: 0.3 }),
      makeRow(2, { kind: "usage-limit", window: "5h", utilization: 0.94 }),
    ];

    const limits = deriveLatestUsageLimits(rows);
    expect(limits).toHaveLength(2);
    const fiveHour = limits.find((usage) => usage.window === "5h");
    expect(fiveHour).toMatchObject({ utilization: 0.94, severity: "warning" });
  });

  test("ignores non usage-limit events", () => {
    expect(
      deriveLatestUsageLimits([makeRow(0, { kind: "text", text: "hi" })])
    ).toEqual([]);
  });
});

describe("mergeUsageLimits", () => {
  test("newer snapshots replace matching windows and keep others", () => {
    const previous = deriveLatestUsageLimits([
      makeRow(0, { kind: "usage-limit", window: "5h", utilization: 0.5 }),
      makeRow(1, { kind: "usage-limit", window: "weekly", utilization: 0.3 }),
    ]);
    const updates = deriveLatestUsageLimits([
      makeRow(2, { kind: "usage-limit", window: "5h", utilization: 0.96 }),
    ]);

    const merged = mergeUsageLimits(previous, updates);
    expect(merged).toHaveLength(2);
    expect(merged.find((usage) => usage.window === "5h")).toMatchObject({
      utilization: 0.96,
      severity: "critical",
    });
    expect(merged.find((usage) => usage.window === "weekly")).toMatchObject({
      utilization: 0.3,
    });
  });
});

describe("formatting", () => {
  test("window labels", () => {
    expect(formatUsageLimitWindowLabel("5h")).toBe("5h limit");
    expect(formatUsageLimitWindowLabel("weekly")).toBe("Weekly limit");
    expect(formatUsageLimitWindowLabel("daily")).toBe("daily limit");
  });

  test("percentage", () => {
    expect(formatUsageLimitPercentage(0.94)).toBe("94%");
    expect(formatUsageLimitPercentage(1.2)).toBe("100%");
    expect(formatUsageLimitPercentage(null)).toBe("—");
  });

  test("relative reset time", () => {
    const nowMs = 1_000_000_000_000;
    const nowSeconds = nowMs / 1000;
    expect(formatUsageLimitReset(nowSeconds + 130 * 60, nowMs)).toBe("in 2h 10m");
    expect(formatUsageLimitReset(nowSeconds + 5 * 60, nowMs)).toBe("in 5m");
    expect(formatUsageLimitReset(nowSeconds + 26 * 3600, nowMs)).toBe("in 1d 2h");
    expect(formatUsageLimitReset(nowSeconds - 10, nowMs)).toBe("now");
    expect(formatUsageLimitReset(null, nowMs)).toBeNull();
  });
});
