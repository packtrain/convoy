import { describe, expect, test } from "vitest";
import { getPlanModeToggleTarget } from "./types";

describe("thread-types helpers", () => {
  test("toggles between agent and plan when plan mode is supported", () => {
    expect(getPlanModeToggleTarget("claude-code", "agent")).toBe("plan");
    expect(getPlanModeToggleTarget("claude-code", "plan")).toBe("agent");
    expect(getPlanModeToggleTarget("claude-code", undefined)).toBe("plan");
    expect(getPlanModeToggleTarget("codex", "agent")).toBe("plan");
    expect(getPlanModeToggleTarget("codex", "plan")).toBe("agent");
  });

  test("returns undefined for plan toggle when plan mode is unsupported", () => {
    expect(getPlanModeToggleTarget("other", "agent")).toBeUndefined();
  });
});
