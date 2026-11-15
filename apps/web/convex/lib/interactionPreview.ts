import type { Doc } from "../_generated/dataModel";
import { isRecord } from "@/lib/type-guards";

/**
 * One-line description of what a mid-run prompt is asking for, used as the
 * notification excerpt for `thread.waiting_input`. Payloads are runtime-built
 * JSON strings (see the per-runtime `interactions.ts` files under
 * `apps/cli/src/agent/runtimes`), so every field is validated rather than cast.
 */
export function describeInteractionRequest(request: Doc<"cliInteractionRequests">): string | undefined {
  const payload = parsePayload(request.payloadJson);

  if (request.kind === "question") {
    return firstQuestion(payload);
  }

  if (request.kind === "plan-approval") {
    return firstLine(payload.plan);
  }

  // tool-approval: the runtime's own title is what the approval card shows.
  return (
    firstLine(payload.title) ??
    firstLine(payload.description) ??
    (typeof payload.toolName === "string" && payload.toolName !== ""
      ? `Wants to use ${payload.toolName}`
      : undefined)
  );
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function firstQuestion(payload: Record<string, unknown>): string | undefined {
  if (!Array.isArray(payload.questions)) {
    return undefined;
  }
  for (const question of payload.questions) {
    const text = isRecord(question) ? firstLine(question.question) : undefined;
    if (text !== undefined) {
      return text;
    }
  }
  return undefined;
}

/** First non-empty line — plans are markdown, and only the opener fits an excerpt. */
function firstLine(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  for (const line of value.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") {
      return trimmed;
    }
  }
  return undefined;
}
