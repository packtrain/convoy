import { describe, expect, test } from "vitest";
import type { CliUiPart } from "@/lib/cli-stream-ui/types";
import {
  getPlanDecisionOptions,
  hasParkedExitPlanMode,
  toPlanApprovalResponseJson,
} from "./plan-decision";

describe("plan decisions", () => {
  test("approve options are named after the runtime's own modes", () => {
    expect(getPlanDecisionOptions("claude-code")).toEqual([
      { key: "approve-auto", label: "Approve & continue in Auto", decision: { nextMode: "auto" } },
      {
        key: "approve-ask-per-tool",
        label: "Approve, ask per tool",
        decision: { nextMode: "default" },
      },
      { key: "approve-act", label: "Approve & continue in Act", decision: { nextMode: "agent" } },
    ]);
    // Codex calls the same supervised mode "Sandboxed".
    expect(getPlanDecisionOptions("codex")[0]?.label).toBe(
      "Approve & continue in Sandboxed"
    );
  });

  test("runtimes without an auto mode offer Ask and Act", () => {
    expect(getPlanDecisionOptions("opencode").map((o) => o.key)).toEqual([
      "approve-ask-per-tool",
      "approve-act",
    ]);
  });

  test("a never-settled ExitPlanMode gate reads as parked; settled or absent does not (OS-1463)", () => {
    const parked: CliUiPart = {
      type: "dynamic-tool",
      toolName: "ExitPlanMode",
      toolCallId: "call_1",
      state: "input-available",
      input: { plan: "# Plan" },
    };
    const settled: CliUiPart = {
      type: "dynamic-tool",
      toolName: "ExitPlanMode",
      toolCallId: "call_1",
      state: "output-error",
      input: { plan: "# Plan" },
      errorText: "answered",
    };
    const text: CliUiPart = { type: "text", text: "done" };

    expect(hasParkedExitPlanMode([text, parked])).toBe(true);
    expect(hasParkedExitPlanMode([text, settled])).toBe(false);
    expect(hasParkedExitPlanMode([text])).toBe(false);
    expect(hasParkedExitPlanMode([])).toBe(false);
  });

  test("bridge response bodies match the CLI contract", () => {
    expect(toPlanApprovalResponseJson({ nextMode: "auto" })).toBe(
      JSON.stringify({ decision: "approve", nextMode: "auto" })
    );
    expect(toPlanApprovalResponseJson({ nextMode: "default" })).toBe(
      JSON.stringify({ decision: "approve", nextMode: "default" })
    );
  });
});
