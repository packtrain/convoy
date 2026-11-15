import type { UIMessage } from "ai";
import { isDynamicToolUIPart } from "@/lib/ai-tools/ai-parts";
import { isRecord } from "@/lib/type-guards";

export type ExitPlanModeToolPayload = {
  toolName: "ExitPlanMode";
  toolCallId: string;
  plan: string;
  errorText?: string;
};

export function parseExitPlanModeToolPart(
  part: UIMessage["parts"][number]
): ExitPlanModeToolPayload | null {
  if (!isDynamicToolUIPart(part)) {
    return null;
  }

  if (part.toolName !== "ExitPlanMode") {
    return null;
  }

  const rawInput = "input" in part ? part.input : undefined;
  if (!isRecord(rawInput)) {
    return null;
  }

  const rawPlan = rawInput.plan;
  if (typeof rawPlan !== "string" || rawPlan.trim().length === 0) {
    return null;
  }

  const maybeErrorText =
    "errorText" in part && typeof part.errorText === "string"
      ? part.errorText
      : undefined;

  return {
    toolName: "ExitPlanMode",
    toolCallId: part.toolCallId,
    plan: rawPlan,
    ...(maybeErrorText ? { errorText: maybeErrorText } : {}),
  };
}
