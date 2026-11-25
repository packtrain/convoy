import { describe, expect, test } from "vitest";
import { getThreadDisplayStatus } from "./display-status";

describe("getThreadDisplayStatus", () => {
  test("a settled thread whose watched PR's checks run shows as working", () => {
    expect(getThreadDisplayStatus({ status: "completed", requiresAttention: false, pullRequestChecksRunning: true })).toBe("streaming");
    expect(getThreadDisplayStatus({ status: "failed", requiresAttention: false, pullRequestChecksRunning: true })).toBe("streaming");
  });

  test("attention and a live run win over running checks", () => {
    expect(getThreadDisplayStatus({ status: "failed", requiresAttention: true, pullRequestChecksRunning: true })).toBe("failed");
    expect(getThreadDisplayStatus({ status: "pending", requiresAttention: false, pullRequestChecksRunning: true })).toBe("pending");
    expect(getThreadDisplayStatus({ status: "completed", requiresAttention: false, pullRequestChecksRunning: false })).toBe("completed");
  });
});
