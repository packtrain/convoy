import type { CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import { isRecord } from "@/lib/type-guards";
import type { RawCliChunk } from "../contracts";

/**
 * Agent Client Protocol chunks → CLI events. Protocol only: agent quirks come in
 * through the tool adapter. Chunk contract: docs/specs/cli-antigravity-runtime.md.
 */

/** How one tool update renders. `errorText` turns a completed update into an error. */
export type AcpToolView = {
  toolName: string;
  input: unknown;
  output: unknown;
  errorText?: string;
};

export type AcpToolAdapter = (update: Record<string, unknown>) => AcpToolView;

const DELTA_UPDATES = new Map<string, "text-delta" | "reasoning-delta">([
  ["agent_message_chunk", "text-delta"],
  ["agent_thought_chunk", "reasoning-delta"],
]);

/** Known updates with nothing to render in this slice. */
const SILENT_UPDATES = new Set([
  "user_message_chunk",
  "plan",
  "available_commands_update",
  "current_mode_update",
  "config_option_update",
  "session_info_update",
  "usage_update",
]);

const STOP_REASON_WARNINGS = new Map([
  ["refusal", "The agent refused to continue."],
  ["max_tokens", "The agent stopped at its output token limit."],
  ["max_turn_requests", "The agent stopped at its limit of model requests for one turn."],
]);

function parse(data: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(data);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function unknownEvent(chunk: RawCliChunk, reason: string): CliNormalizedEvent {
  return { kind: "unknown", reason, rawType: chunk.type, rawData: chunk.data };
}

function silent(payload: Record<string, unknown>, sessionId?: string): CliNormalizedEvent {
  return { kind: "metadata", ...(sessionId ? { sessionId } : {}), otherJson: JSON.stringify(payload) };
}

/** Text of a tool update's `content` blocks. */
export function acpContentText(update: Record<string, unknown>): string {
  if (!Array.isArray(update.content)) return "";
  return update.content
    .map((entry) => (isRecord(entry) && isRecord(entry.content) ? getString(entry.content.text) ?? "" : ""))
    .join("");
}

export const defaultAcpTool: AcpToolAdapter = (update) => ({
  toolName: getString(update.title) ?? getString(update.kind) ?? "Tool",
  input: update.rawInput ?? {},
  output: update.rawOutput ?? acpContentText(update),
  ...(update.status === "failed" ? { errorText: acpContentText(update) || "Tool failed." } : {}),
});

function normalizeToolUpdate(update: Record<string, unknown>, adapter: AcpToolAdapter): CliNormalizedEvent {
  const toolCallId = getString(update.toolCallId);
  const status = getString(update.status);
  const view = adapter(update);
  if (update.sessionUpdate === "tool_call") {
    return { kind: "tool-input", toolCallId, toolName: view.toolName, inputJson: JSON.stringify(view.input) };
  }
  if (status === "failed" || (status === "completed" && view.errorText !== undefined)) {
    return { kind: "tool-error", toolCallId, errorText: view.errorText ?? "Tool failed." };
  }
  if (status === "completed") {
    return { kind: "tool-output", toolCallId, outputJson: JSON.stringify(view.output ?? "") };
  }
  return silent({ event: "tool_call_update", status: status ?? null });
}

export function normalizeAcpChunk(chunk: RawCliChunk, adapter: AcpToolAdapter = defaultAcpTool): CliNormalizedEvent {
  const data = parse(chunk.data);
  if (!data) return unknownEvent(chunk, "unparseable-acp-chunk");
  const sessionId = getString(data.sessionId);

  switch (chunk.type) {
    case "convoy/acp_session":
      return silent({ event: chunk.type, agentVersion: data.agentVersion ?? null }, sessionId);
    case "convoy/acp_text":
      return { kind: "text", text: getString(data.text) ?? "" };
    case "convoy/acp_reasoning":
      return { kind: "reasoning", text: getString(data.text) ?? "" };
    case "convoy/acp_prompt_result": {
      const stopReason = getString(data.stopReason) ?? "end_turn";
      const warning = STOP_REASON_WARNINGS.get(stopReason);
      return warning
        ? { kind: "warning", code: `acp-${stopReason}`, message: warning }
        : silent({ event: chunk.type, stopReason, usage: data.usage ?? null }, sessionId);
    }
    case "session/update": {
      const update = isRecord(data.update) ? data.update : {};
      const kind = getString(update.sessionUpdate) ?? "";
      const delta = DELTA_UPDATES.get(kind);
      if (delta) {
        const content = isRecord(update.content) ? update.content : {};
        return { kind: delta, text: getString(content.text) ?? "" };
      }
      if (kind === "tool_call" || kind === "tool_call_update") return normalizeToolUpdate(update, adapter);
      if (SILENT_UPDATES.has(kind)) return silent({ event: kind }, sessionId);
      return unknownEvent(chunk, "unrecognized-acp-update");
    }
    default:
      return unknownEvent(chunk, "unrecognized-acp-chunk");
  }
}

/** Live message and thought chunks; the closed segment's `convoy/acp_*` chunk supersedes them. */
export function isAcpEphemeralChunk(chunk: RawCliChunk): boolean {
  if (chunk.type !== "session/update") return false;
  const update = parse(chunk.data)?.update;
  return isRecord(update) && DELTA_UPDATES.has(getString(update.sessionUpdate) ?? "");
}

export function getAcpContinuationIdFromIncomingChunks(chunks: RawCliChunk[]): string | null {
  for (const chunk of chunks) {
    if (chunk.type !== "convoy/acp_session") continue;
    const sessionId = getString(parse(chunk.data)?.sessionId);
    if (sessionId) return sessionId;
  }
  return null;
}
