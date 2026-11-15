import type { DynamicToolUIPart } from "ai";

export function isDynamicToolUIPart(
  part: { type: string }
): part is DynamicToolUIPart {
  return part.type === "dynamic-tool";
}
