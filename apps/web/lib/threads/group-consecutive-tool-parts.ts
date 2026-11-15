import type { DynamicToolUIPart, ReasoningUIPart } from "ai";
import { isDynamicToolUIPart } from "@/lib/ai-tools/ai-parts";
import { parseAskUserQuestionToolPart } from "@/lib/ai-tools/ask-user-question";
import { parseExitPlanModeToolPart } from "@/lib/ai-tools/exit-plan-mode";
import type { CliUiPart } from "@/lib/cli-stream-ui";

/**
 * Reasoning interleaves with tool calls in practice (Claude Code emits one
 * event per assistant content block), so it rides along inside a group instead
 * of splitting it. Assistant text is user-facing narration and stays outside.
 */
export type ToolGroupPartItem = DynamicToolUIPart | ReasoningUIPart;

export type ToolGroup = {
  type: "tool-group";
  parts: ToolGroupPartItem[];
};

export type GroupedPart = CliUiPart | ToolGroup;

const MIN_GROUP_SIZE = 2;

export function isToolGroup(item: GroupedPart): item is ToolGroup {
  return (
    typeof item === "object" &&
    item !== null &&
    "type" in item &&
    item.type === "tool-group"
  );
}

/**
 * Tools that stay top-level rows and split the run around them: the two
 * interactive prompts, plus anything that failed — a failure folded into a
 * neutral "Worked for …" row would need expanding to be noticed at all. This
 * also covers the calls OS-1435 settles as `Interrupted` on a stopped run.
 */
function isExcludedTool(part: DynamicToolUIPart): boolean {
  return (
    part.state === "output-error" ||
    parseAskUserQuestionToolPart(part) !== null ||
    parseExitPlanModeToolPart(part) !== null
  );
}

function isReasoningPart(part: CliUiPart): part is ReasoningUIPart {
  return part.type === "reasoning";
}

export function countToolParts(parts: ToolGroupPartItem[]): number {
  return parts.filter((part) => part.type === "dynamic-tool").length;
}

function flushBuffer(buffer: ToolGroupPartItem[], result: GroupedPart[]): void {
  // Reasoning alone is never a group — it only joins one that has enough tools.
  if (countToolParts(buffer) < MIN_GROUP_SIZE) {
    for (const part of buffer) {
      result.push(part);
    }
    buffer.length = 0;
    return;
  }

  result.push({ type: "tool-group", parts: [...buffer] });
  buffer.length = 0;
}

export function groupConsecutiveToolParts(parts: CliUiPart[]): GroupedPart[] {
  const result: GroupedPart[] = [];
  const buffer: ToolGroupPartItem[] = [];

  for (const part of parts) {
    if (isDynamicToolUIPart(part) && !isExcludedTool(part)) {
      buffer.push(part);
      continue;
    }

    // Reasoning only joins a run already in progress; leading reasoning (empty
    // buffer) stays outside, and a run that never reaches the threshold flushes
    // its reasoning back out in stream order.
    if (isReasoningPart(part) && buffer.length > 0) {
      buffer.push(part);
      continue;
    }

    flushBuffer(buffer, result);
    result.push(part);
  }

  flushBuffer(buffer, result);
  return result;
}
