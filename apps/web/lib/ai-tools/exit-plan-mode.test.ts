import { describe, expect, test } from "vitest";
import { parseExitPlanModeToolPart } from "./exit-plan-mode";

describe("exit-plan-mode parser", () => {
  test("parses valid ExitPlanMode output-error tool part", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "ExitPlanMode",
      toolCallId: "toolu_exit_1",
      state: "output-error",
      input: {
        plan: "# Plan title\n\n- Step 1\n- Step 2",
      },
      errorText: "Exit plan mode?",
    } as const;

    const parsed = parseExitPlanModeToolPart(part);
    expect(parsed).toEqual({
      toolName: "ExitPlanMode",
      toolCallId: "toolu_exit_1",
      plan: "# Plan title\n\n- Step 1\n- Step 2",
      errorText: "Exit plan mode?",
    });
  });

  test("parses a plan still awaiting the approval decision", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "ExitPlanMode",
      toolCallId: "toolu_exit_1",
      state: "input-available",
      input: { plan: "# Plan" },
    } as const;

    expect(parseExitPlanModeToolPart(part)).toEqual({
      toolName: "ExitPlanMode",
      toolCallId: "toolu_exit_1",
      plan: "# Plan",
    });
  });

  test("parses an approved plan (output-available)", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "ExitPlanMode",
      toolCallId: "toolu_exit_1",
      state: "output-available",
      input: { plan: "# Plan" },
      output: { ok: true },
    } as const;

    expect(parseExitPlanModeToolPart(part)?.plan).toBe("# Plan");
  });

  test("returns null for non-ExitPlanMode tools", () => {
    const part = {
      type: "dynamic-tool",
      toolName: "Read",
      toolCallId: "toolu_read_1",
      state: "output-error",
      input: { plan: "# Plan" },
      errorText: "nope",
    } as const;

    expect(parseExitPlanModeToolPart(part)).toBeNull();
  });

  test("returns null when input.plan is missing or empty", () => {
    const missingPlan = {
      type: "dynamic-tool",
      toolName: "ExitPlanMode",
      toolCallId: "toolu_exit_1",
      state: "output-error",
      input: {},
      errorText: "Exit plan mode?",
    } as const;

    const emptyPlan = {
      type: "dynamic-tool",
      toolName: "ExitPlanMode",
      toolCallId: "toolu_exit_2",
      state: "output-error",
      input: { plan: "   " },
      errorText: "Exit plan mode?",
    } as const;

    expect(parseExitPlanModeToolPart(missingPlan)).toBeNull();
    expect(parseExitPlanModeToolPart(emptyPlan)).toBeNull();
  });
});
