import type { CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import { isRecord } from "@/lib/type-guards";
import type { RawCliChunk } from "../contracts";

/**
 * Normalize `cursor-agent -p --output-format=stream-json` JSONL events into
 * provider-agnostic CLI events. Types: `system`, `user`, `assistant`, `thinking`,
 * `tool_call` (correlated by `call_id`), `result`, plus the synthetic
 * `convoy.commands` inventory chunk.
 *
 * Text arrives as micro-chunks, but the runner coalesces and the composer merges, so
 * each chunk normalizes to a whole (non-delta) event.
 */

function safeJsonParse(data: string): unknown | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function unknownEvent(chunk: RawCliChunk, reason: string): CliNormalizedEvent {
  return {
    kind: "unknown",
    reason,
    rawType: chunk.type,
    rawData: chunk.data,
  };
}

function silentMetadata(payload: Record<string, unknown>): CliNormalizedEvent {
  return { kind: "metadata", otherJson: JSON.stringify(payload) };
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function concatMessageText(message: unknown): string {
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return "";
  }
  return message.content
    .map((item) => (isRecord(item) ? (getString(item.text) ?? "") : ""))
    .join("");
}

/** Wrapper keys of cursor `tool_call.tool_call` payloads → display names. */
const CURSOR_TOOL_NAMES: Record<string, string> = {
  shellToolCall: "Shell",
  readToolCall: "Read",
  editToolCall: "Edit",
  writeToolCall: "Write",
  grepToolCall: "Grep",
  globToolCall: "Glob",
  lsToolCall: "LS",
  semSearchToolCall: "Search",
  deleteToolCall: "Delete",
  updateTodosToolCall: "Update todos",
};

type CursorToolCallPayload = {
  wrapperKey: string;
  toolName: string;
  args: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
};

function parseToolCallPayload(toolCall: unknown): CursorToolCallPayload | null {
  if (!isRecord(toolCall)) {
    return null;
  }
  const wrapperKey = Object.keys(toolCall).find((key) =>
    isRecord(toolCall[key]),
  );
  if (!wrapperKey) {
    return null;
  }
  const inner = toolCall[wrapperKey] as Record<string, unknown>;
  const args = isRecord(inner.args) ? inner.args : null;

  let toolName = CURSOR_TOOL_NAMES[wrapperKey] ?? wrapperKey;
  if (wrapperKey === "mcpToolCall") {
    const provider = getString(args?.providerIdentifier);
    const tool = getString(args?.toolName) ?? getString(args?.name);
    toolName = [provider, tool].filter(Boolean).join(".") || "MCP tool";
  }

  return {
    wrapperKey,
    toolName,
    args,
    result: isRecord(inner.result) ? inner.result : null,
  };
}

/**
 * Shell results are either wrapped (`{success: {...}} | {failure: {...}}`)
 * or flat `{stdout, stderr, exitCode}`. Returns the exit code when one is
 * present in any of those shapes.
 */
function getShellExitCode(result: Record<string, unknown>): number | null {
  const candidates = [result.success, result.failure, result];
  for (const candidate of candidates) {
    if (isRecord(candidate) && typeof candidate.exitCode === "number") {
      return candidate.exitCode;
    }
  }
  return null;
}

function isFailedToolResult(payload: CursorToolCallPayload): boolean {
  const result = payload.result;
  if (!result) {
    return false;
  }
  if ("failure" in result || result.isError === true) {
    return true;
  }
  if (payload.wrapperKey === "shellToolCall") {
    const exitCode = getShellExitCode(result);
    return exitCode !== null && exitCode !== 0;
  }
  return false;
}

function normalizeToolCallEvent(
  chunk: RawCliChunk,
  obj: Record<string, unknown>,
): CliNormalizedEvent {
  const subtype = getString(obj.subtype);
  const toolCallId = getString(obj.call_id);
  const payload = parseToolCallPayload(obj.tool_call);
  if (!payload) {
    return unknownEvent(chunk, "cursor-tool-call-without-payload");
  }

  if (subtype === "started") {
    return {
      kind: "tool-input",
      toolCallId,
      toolName: payload.toolName,
      inputJson: JSON.stringify(payload.args ?? {}),
    };
  }
  if (subtype !== "completed") {
    return silentMetadata({ event: `tool_call.${subtype ?? "unknown"}` });
  }

  if (isFailedToolResult(payload)) {
    return {
      kind: "tool-error",
      toolCallId,
      errorText: `${payload.toolName} failed.\n${JSON.stringify(payload.result)}`,
    };
  }
  return {
    kind: "tool-output",
    toolCallId,
    outputJson: JSON.stringify(payload.result ?? {}),
  };
}

export function normalizeCursorChunk(chunk: RawCliChunk): CliNormalizedEvent {
  const parsed = safeJsonParse(chunk.data);
  const obj = isRecord(parsed) ? parsed : null;
  if (!obj) {
    return unknownEvent(chunk, "unparseable-cursor-chunk");
  }

  switch (chunk.type) {
    case "system":
      // Deliberately no sessionId: cursor's init event may fire before the
      // session is initialized, so the id is taken from later events.
      return silentMetadata({
        event: "init",
        model: getString(obj.model) ?? null,
        permissionMode: getString(obj.permissionMode) ?? null,
      });
    case "user":
      // Prompt echo; not rendered.
      return {
        kind: "metadata",
        sessionId: getString(obj.session_id),
        otherJson: JSON.stringify({ event: "user" }),
      };
    case "assistant": {
      const text = concatMessageText(obj.message);
      return text.length > 0
        ? { kind: "text", text }
        : silentMetadata({ event: "assistant-empty" });
    }
    case "thinking": {
      const text = getString(obj.text) ?? "";
      return text.length > 0
        ? { kind: "reasoning", text }
        : silentMetadata({ event: "thinking-empty" });
    }
    // Newer builds (2026.07+) also stream flat text events
    // (`{type:"text", subtype, text}`, same shape as thinking).
    case "text": {
      const text = getString(obj.text) ?? "";
      return text.length > 0
        ? { kind: "text", text }
        : silentMetadata({ event: "text-empty" });
    }
    case "tool_call":
      return normalizeToolCallEvent(chunk, obj);
    case "result": {
      if (obj.is_error === true) {
        return {
          kind: "runtime-notice",
          code: "cursor-run-failed",
          title: "Cursor run failed",
          message: getString(obj.result) ?? "Cursor could not complete the run.",
          detailsJson: chunk.data,
        };
      }
      return silentMetadata({
        event: "result",
        durationMs: typeof obj.duration_ms === "number" ? obj.duration_ms : null,
      });
    }
    case "convoy.commands":
      return silentMetadata({ event: "convoy.commands" });
    default:
      return unknownEvent(chunk, "unrecognized-cursor-event");
  }
}

/**
 * Cursor chat id from stored raw chunks: the first `session_id` on a
 * non-`system` event. `system` is skipped because the session may not be
 * initialized when it fires.
 */
export function getCursorContinuationIdFromIncomingChunks(
  chunks: RawCliChunk[],
): string | null {
  for (const chunk of chunks) {
    if (chunk.type === "system" || chunk.type === "convoy.commands") {
      continue;
    }
    const parsed = safeJsonParse(chunk.data);
    const sessionId = isRecord(parsed)
      ? getString(parsed.session_id)
      : undefined;
    if (sessionId && sessionId.length > 0) {
      return sessionId;
    }
  }
  return null;
}
