import type { CliNormalizedEvent } from "../../lib/contracts/validators";
import { isRecord } from "@/lib/type-guards";

const NORMALIZED_TOOL_NAME = "askuserquestion";
const EXIT_PLAN_MODE_TOOL_NAME = "ExitPlanMode";

function normalizeToolName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isAskUserQuestionToolName(value: unknown): boolean {
  return (
    typeof value === "string" &&
    normalizeToolName(value) === NORMALIZED_TOOL_NAME
  );
}

function hasValidAskUserQuestionInput(input: unknown): boolean {
  if (!isRecord(input)) {
    return false;
  }

  const questions = input.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    return false;
  }

  return questions.every((question) => {
    if (!isRecord(question)) {
      return false;
    }

    if (typeof question.question !== "string" || question.question.length === 0) {
      return false;
    }

    if (!Array.isArray(question.options) || question.options.length === 0) {
      return false;
    }

    return question.options.some(
      (option) => isRecord(option) && typeof option.label === "string"
    );
  });
}

function hasValidExitPlanModeInput(input: unknown): boolean {
  if (!isRecord(input)) {
    return false;
  }

  const plan = input.plan;
  return typeof plan === "string" && plan.trim().length > 0;
}

function isExitPlanModeToolName(value: unknown): boolean {
  return value === EXIT_PLAN_MODE_TOOL_NAME;
}

function parseInputJson(inputJson: string): unknown {
  try {
    return JSON.parse(inputJson);
  } catch {
    return undefined;
  }
}

/**
 * Scan normalized events for a tool-input + tool-error pair where the tool
 * is AskUserQuestion or ExitPlanMode with valid input.
 *
 * This indicates the agent is waiting for user input.
 */
export function hasAwaitingUserInputTool(
  events: CliNormalizedEvent[]
): boolean {
  const toolInputById = new Map<string, { toolName: string; input: unknown }>();

  for (const event of events) {
    if (event.kind === "tool-input") {
      if (!event.toolCallId) continue;
      toolInputById.set(event.toolCallId, {
        toolName: event.toolName,
        input: parseInputJson(event.inputJson),
      });
      continue;
    }

    if (event.kind !== "tool-error") {
      continue;
    }

    if (!event.toolCallId) continue;
    const toolInput = toolInputById.get(event.toolCallId);
    if (!toolInput) {
      continue;
    }

    if (
      isAskUserQuestionToolName(toolInput.toolName) &&
      hasValidAskUserQuestionInput(toolInput.input)
    ) {
      return true;
    }

    if (
      isExitPlanModeToolName(toolInput.toolName) &&
      hasValidExitPlanModeInput(toolInput.input)
    ) {
      return true;
    }
  }

  return false;
}
