import { describe, expect, test } from "vitest";
import type { CliNormalizedEvent } from "../../lib/contracts/validators";
import { hasAwaitingUserInputTool } from "./waitingInput";

function toolInput(
  toolCallId: string,
  toolName: string,
  input: unknown,
): CliNormalizedEvent {
  return { kind: "tool-input", toolCallId, toolName, inputJson: JSON.stringify(input) };
}

function toolError(toolCallId: string): CliNormalizedEvent {
  return { kind: "tool-error", toolCallId, errorText: "rejected" };
}

const askUserQuestionInput = {
  questions: [{ question: "Pick one", options: [{ label: "A" }, { label: "B" }] }],
};

describe("hasAwaitingUserInputTool", () => {
  test("true for an AskUserQuestion tool-input followed by a tool-error", () => {
    const events = [
      toolInput("t1", "AskUserQuestion", askUserQuestionInput),
      toolError("t1"),
    ];
    expect(hasAwaitingUserInputTool(events)).toBe(true);
  });

  test("matches AskUserQuestion regardless of casing/punctuation", () => {
    const events = [
      toolInput("t1", "ask_user-question", askUserQuestionInput),
      toolError("t1"),
    ];
    expect(hasAwaitingUserInputTool(events)).toBe(true);
  });

  test("true for an ExitPlanMode tool-input with a non-empty plan", () => {
    const events = [
      toolInput("t1", "ExitPlanMode", { plan: "Do the thing" }),
      toolError("t1"),
    ];
    expect(hasAwaitingUserInputTool(events)).toBe(true);
  });

  test("false when the tool-input has no matching tool-error", () => {
    const events = [toolInput("t1", "AskUserQuestion", askUserQuestionInput)];
    expect(hasAwaitingUserInputTool(events)).toBe(false);
  });

  test("false when the error references a different toolCallId", () => {
    const events = [
      toolInput("t1", "AskUserQuestion", askUserQuestionInput),
      toolError("t2"),
    ];
    expect(hasAwaitingUserInputTool(events)).toBe(false);
  });

  test("false for AskUserQuestion with no questions", () => {
    const events = [
      toolInput("t1", "AskUserQuestion", { questions: [] }),
      toolError("t1"),
    ];
    expect(hasAwaitingUserInputTool(events)).toBe(false);
  });

  test("false for AskUserQuestion with a question missing options", () => {
    const events = [
      toolInput("t1", "AskUserQuestion", { questions: [{ question: "Q", options: [] }] }),
      toolError("t1"),
    ];
    expect(hasAwaitingUserInputTool(events)).toBe(false);
  });

  test("false for ExitPlanMode with a blank plan", () => {
    const events = [
      toolInput("t1", "ExitPlanMode", { plan: "   " }),
      toolError("t1"),
    ];
    expect(hasAwaitingUserInputTool(events)).toBe(false);
  });

  test("false for an unrelated tool", () => {
    const events = [
      toolInput("t1", "Bash", { command: "ls" }),
      toolError("t1"),
    ];
    expect(hasAwaitingUserInputTool(events)).toBe(false);
  });

  test("false for non-tool events", () => {
    const events: CliNormalizedEvent[] = [
      { kind: "text", text: "hello" },
      { kind: "reasoning", text: "thinking" },
    ];
    expect(hasAwaitingUserInputTool(events)).toBe(false);
  });
});
