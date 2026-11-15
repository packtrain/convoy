import { z } from "zod";
import { validMcpForm } from "../validators.js";
import { randomUUID } from "node:crypto";
import type {
  CanUseTool,
  OnElicitation,
  PermissionMode,
  PermissionResult,
  PermissionUpdate,
  Query,
} from "@anthropic-ai/claude-agent-sdk";
import { isRecord } from "../../sdk/adapters/adapter-interface.js";
import type { CliMode, InteractionBridge, InteractionKind } from "../contracts.js";

const SDK_PERMISSION_MODES = new Set<PermissionMode>([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
  "auto",
]);

/** Thread/message mode → SDK permission mode. `agent` is legacy full access. */
export function toClaudePermissionMode(mode: CliMode | undefined): PermissionMode {
  if (mode === undefined || mode === "agent") {
    return "bypassPermissions";
  }
  return mode;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function denied(message: string): PermissionResult {
  return { behavior: "deny", message };
}

type CanUseToolOptions = Parameters<CanUseTool>[2];

function classifyRequest(
  toolName: string
): InteractionKind {
  if (toolName === "ExitPlanMode") {
    return "plan-approval";
  }
  if (toolName === "AskUserQuestion") {
    return "question";
  }
  return "tool-approval";
}

function buildPayloadJson(
  kind: InteractionKind,
  toolName: string,
  input: Record<string, unknown>,
  options: CanUseToolOptions
): string {
  if (kind === "plan-approval") {
    return JSON.stringify({
      toolName,
      plan: typeof input.plan === "string" ? input.plan : "",
    });
  }

  if (kind === "question") {
    return JSON.stringify({
      toolName,
      questions: Array.isArray(input.questions) ? input.questions : [],
    });
  }

  return JSON.stringify({
    toolName,
    inputJson: JSON.stringify(input),
    title: options.title,
    displayName: options.displayName,
    description: options.description,
    decisionReason: options.decisionReason,
    blockedPath: options.blockedPath,
    hasSuggestions: (options.suggestions?.length ?? 0) > 0,
  });
}

function toToolApprovalResult(
  response: Record<string, unknown>,
  input: Record<string, unknown>,
  suggestions: PermissionUpdate[] | undefined
): PermissionResult {
  const decision = response.decision;
  // The bridge's runtime schema requires `updatedInput` on allow results
  // even though the SDK type marks it optional; omit it and the whole
  // permission request fails with a ZodError.
  if (decision === "allow") {
    return { behavior: "allow", updatedInput: input };
  }
  if (decision === "allow-always") {
    return {
      behavior: "allow",
      updatedInput: input,
      ...(suggestions && suggestions.length > 0
        ? { updatedPermissions: suggestions }
        : {}),
    };
  }
  return denied(
    typeof response.message === "string" && response.message.trim().length > 0
      ? response.message
      : "User denied this tool use."
  );
}

function toQuestionResult(
  response: Record<string, unknown>,
  input: Record<string, unknown>
): PermissionResult {
  if (!isRecord(response.answers)) {
    return denied("User dismissed the question.");
  }

  // SDK contract: allow with { questions, answers: { [questionText]: label } }.
  // Keep only string labels so malformed JSON cannot corrupt the tool input.
  const answers: Record<string, string> = {};
  for (const [question, label] of Object.entries(response.answers)) {
    if (typeof label === "string" && label.length > 0) {
      answers[question] = label;
    }
  }
  if (Object.keys(answers).length === 0) {
    return denied("User dismissed the question.");
  }

  return {
    behavior: "allow",
    updatedInput: {
      questions: input.questions,
      answers,
    },
  };
}

async function toPlanApprovalResult(
  response: Record<string, unknown>,
  input: Record<string, unknown>,
  getActiveQuery: () => Query | null
): Promise<PermissionResult> {
  // `approve` is the only decision the web sends (OS-1461): keeping planning is
  // a sent message that ends the run, not an answer to this gate. So anything
  // else is an unexpected or malformed response — deny rather than let the plan
  // start on an answer nobody gave.
  if (response.decision !== "approve") {
    return denied(
      typeof response.message === "string" && response.message.trim().length > 0
        ? response.message
        : "The plan was not approved. Ask the user what to change instead of implementing it."
    );
  }

  const requestedMode = response.nextMode === "agent"
    ? toClaudePermissionMode("agent")
    : response.nextMode;
  const nextMode =
    typeof requestedMode === "string" &&
    SDK_PERMISSION_MODES.has(requestedMode as PermissionMode) &&
    requestedMode !== "plan"
      ? (requestedMode as PermissionMode)
      : "default";

  // The approved mode must be active before execution continues; approving
  // while silently staying in the previous mode would violate user intent.
  try {
    await getActiveQuery()?.setPermissionMode(nextMode);
  } catch {
    return denied(
      "Could not switch the session permission mode; the plan was not started. Ask the user to approve again."
    );
  }

  return { behavior: "allow", updatedInput: input };
}

/**
 * Build the Agent SDK `canUseTool` callback backed by the provider-neutral
 * interaction bridge (Convex signaling). Every provider prompt is parked on
 * the bridge; abort resolves to a deny so the run can end cleanly.
 */
export function createClaudeCanUseTool(params: {
  bridge: InteractionBridge;
  getActiveQuery: () => Query | null;
}): (...args: Parameters<CanUseTool>) => Promise<PermissionResult> {
  return async (toolName, input, options) => {
    const kind = classifyRequest(toolName);
    const requestId = randomUUID();

    let responseJson: string;
    try {
      responseJson = await params.bridge.request(
        {
          requestId,
          kind,
          payloadJson: buildPayloadJson(kind, toolName, input, options),
        },
        options.signal
      );
    } catch (error) {
      params.bridge.cancel(requestId, { abandoned: true, reason: "aborted" });
      return denied(
        error instanceof Error && error.message
          ? error.message
          : "Approval request was cancelled."
      );
    }

    const response = safeJsonParse(responseJson);
    if (!isRecord(response)) {
      return denied("Approval response was malformed.");
    }

    if (kind === "question") {
      return toQuestionResult(response, input);
    }
    if (kind === "plan-approval") {
      return toPlanApprovalResult(response, input, params.getActiveQuery);
    }
    return toToolApprovalResult(response, input, options.suggestions);
  };
}

/** MCP requests use the same cards as Codex, with SDK-specific response shapes. */
export function createClaudeOnElicitation(params: {
  bridge: InteractionBridge;
}): OnElicitation {
  return async (request, { signal }) => {
    const requestId = randomUUID();
    const mode = request.mode ?? "form";
    try {
      if (signal.aborted) return { action: "cancel" };
      const response = safeJsonParse(await params.bridge.request({
        requestId,
        kind: "question",
        payloadJson: JSON.stringify({ ...request, mode, elicitation: true, isBlocking: true }),
      }, signal));
      if (signal.aborted) return { action: "cancel" };
      if (!isRecord(response)) return { action: "decline" };
      if (response.action === "cancel") return { action: "cancel" };
      if (response.action !== "accept") return { action: "decline" };
      if (mode === "url") {
        return { action: z.url({ protocol: /^https?$/ }).safeParse(request.url).success ? "accept" : "decline" };
      }
      if (mode !== "form" || !validMcpForm(request.requestedSchema, response.content)) return { action: "decline" };
      return { action: "accept", content: response.content as Record<string, string | number | boolean | string[]> };
    } catch {
      params.bridge.cancel(requestId, { abandoned: true, reason: "elicitation cancelled" });
      return { action: "cancel" };
    }
  };
}
