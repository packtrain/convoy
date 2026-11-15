import type { CliNormalizedEvent } from "@/convex/lib/contracts/validators";
import { getFiniteNumber, isRecord } from "@/lib/type-guards";
import type { RawCliChunk } from "../contracts";

/**
 * Normalize OpenCode SDK events (forwarded by the CLI executor's event pump) into
 * provider-agnostic CLI events.
 *
 * Chunk contract with the executor:
 * - raw SDK events pass through with `type` = `event.type` and `data` = the event JSON;
 * - synthesized `text.delta` / `reasoning.delta` are exact suffixes (the executor
 *   reconciles OpenCode's cumulative snapshots against its deltas) and are ephemeral,
 *   superseded by the final `message.part.updated` part;
 * - `permission.asked` / `question.asked` go through the interaction bridge instead.
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

function silentMetadata(
  payload: Record<string, unknown>,
  sessionId?: string,
): CliNormalizedEvent {
  return {
    kind: "metadata",
    ...(sessionId ? { sessionId } : {}),
    otherJson: JSON.stringify(payload),
  };
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isPartCompleted(part: Record<string, unknown>): boolean {
  const time = getRecord(part.time);
  return time !== null && time.end !== undefined && time.end !== null;
}

function normalizeToolPart(
  chunk: RawCliChunk,
  part: Record<string, unknown>,
): CliNormalizedEvent {
  const state = getRecord(part.state);
  if (!state) {
    return unknownEvent(chunk, "opencode-tool-part-without-state");
  }

  const toolCallId = getString(part.callID) ?? getString(part.id);
  const toolName = getString(part.tool) ?? "Tool";
  const status = getString(state.status);

  switch (status) {
    case "running":
      return {
        kind: "tool-input",
        toolCallId,
        toolName,
        inputJson: JSON.stringify(state.input ?? {}),
      };
    case "completed": {
      const title = getString(state.title);
      return {
        kind: "tool-output",
        toolCallId,
        outputJson: JSON.stringify({
          output: state.output ?? "",
          ...(title ? { title } : {}),
        }),
      };
    }
    case "error":
      return {
        kind: "tool-error",
        toolCallId,
        errorText: getString(state.error) ?? `Tool ${toolName} failed.`,
      };
    default:
      // "pending" and future states carry no renderable payload yet.
      return silentMetadata({ event: chunk.type, tool: toolName, status });
  }
}

function normalizePartUpdated(
  chunk: RawCliChunk,
  properties: Record<string, unknown>,
): CliNormalizedEvent {
  const part = getRecord(properties.part);
  if (!part) {
    return unknownEvent(chunk, "opencode-part-event-without-part");
  }

  const sessionId = getString(part.sessionID) ?? getString(properties.sessionID);
  const partType = getString(part.type) ?? "unknown";

  switch (partType) {
    case "text": {
      if (!isPartCompleted(part)) {
        // Cumulative snapshot of an in-flight part; live streaming is served
        // by the executor's `text.delta` chunks.
        return silentMetadata({ event: chunk.type, partType }, sessionId);
      }
      return { kind: "text", text: getString(part.text) ?? "" };
    }
    case "reasoning": {
      if (!isPartCompleted(part)) {
        return silentMetadata({ event: chunk.type, partType }, sessionId);
      }
      const text = getString(part.text) ?? "";
      return text.length > 0
        ? { kind: "reasoning", text }
        : silentMetadata({ event: chunk.type, partType }, sessionId);
    }
    case "tool":
      return normalizeToolPart(chunk, part);
    case "step-start":
      return silentMetadata({ event: chunk.type, partType }, sessionId);
    case "step-finish":
      return silentMetadata(
        { event: chunk.type, partType, tokens: part.tokens ?? null, cost: part.cost ?? null },
        sessionId,
      );
    default:
      return silentMetadata({ event: chunk.type, partType }, sessionId);
  }
}

function normalizeSessionStatus(
  properties: Record<string, unknown>,
): CliNormalizedEvent {
  const sessionId = getString(properties.sessionID);
  const status = getRecord(properties.status);
  const statusType = getString(status?.type) ?? "unknown";

  if (statusType === "retry") {
    const message = getString(status?.message);
    return {
      kind: "warning",
      code: "opencode-retry",
      message: message ?? "OpenCode is retrying the request.",
    };
  }

  return silentMetadata({ event: "session.status", status: statusType }, sessionId);
}

function normalizeSessionError(
  properties: Record<string, unknown>,
): CliNormalizedEvent {
  const error = getRecord(properties.error);
  const data = getRecord(error?.data);
  const message =
    getString(data?.message) ??
    getString(error?.name) ??
    "OpenCode reported an error.";

  return {
    kind: "warning",
    code: "opencode-session-error",
    message,
  };
}

function normalizeStreamingDelta(
  chunk: RawCliChunk,
  kind: "text-delta" | "reasoning-delta",
): CliNormalizedEvent {
  const parsed = safeJsonParse(chunk.data);
  const obj = getRecord(parsed);
  const text = getString(obj?.text);
  if (text === undefined) {
    return unknownEvent(chunk, "opencode-delta-without-text");
  }

  return { kind, text };
}

/**
 * Streaming delta chunks are redundant once the completed part arrives; they
 * are marked ephemeral so completion can delete their rows.
 */
export function isOpencodeEphemeralChunk(chunk: RawCliChunk): boolean {
  return chunk.type === "text.delta" || chunk.type === "reasoning.delta";
}

export function normalizeOpencodeChunk(chunk: RawCliChunk): CliNormalizedEvent {
  if (chunk.type === "text.delta") {
    return normalizeStreamingDelta(chunk, "text-delta");
  }
  if (chunk.type === "reasoning.delta") {
    return normalizeStreamingDelta(chunk, "reasoning-delta");
  }

  const parsed = safeJsonParse(chunk.data);
  const obj = getRecord(parsed);
  if (!obj) {
    return unknownEvent(chunk, "unparseable-opencode-chunk");
  }

  const properties = getRecord(obj.properties) ?? {};

  switch (chunk.type) {
    case "convoy.context_usage": {
      const usedTokens = getFiniteNumber(obj.usedTokens);
      const maxTokens = getFiniteNumber(obj.maxTokens);
      return usedTokens !== undefined && usedTokens > 0 && maxTokens !== undefined && maxTokens > 0
        ? { kind: "context-window", usedTokens, maxTokens }
        : silentMetadata({ event: chunk.type });
    }
    case "message.part.updated":
      return normalizePartUpdated(chunk, properties);
    case "session.status":
      return normalizeSessionStatus(properties);
    case "session.error":
      return normalizeSessionError(properties);
    case "message.updated":
    case "message.removed":
    case "permission.replied":
    case "question.replied":
    case "question.rejected":
      return silentMetadata(
        { event: chunk.type },
        getString(properties.sessionID),
      );
    // `/compact` finished (OS-1614). The compaction itself streams as an
    // ordinary turn; this event is the confirmation row.
    case "session.compacted":
      return {
        kind: "context-compaction",
        message: "Conversation compacted",
        detailsJson: chunk.data,
      };
    // Synthetic runner chunk carrying the command.list() inventory; the
    // backend captures it into cliRuntimeFacts, nothing to render.
    case "convoy.commands":
      return silentMetadata({ event: chunk.type });
    default:
      return unknownEvent(chunk, "unrecognized-opencode-event");
  }
}

/**
 * OpenCode session id from stored raw chunks. Every subscribed SDK event
 * carries `properties.sessionID`; delta chunks carry a top-level `sessionID`.
 */
export function getOpencodeContinuationIdFromIncomingChunks(
  chunks: RawCliChunk[],
): string | null {
  for (const chunk of chunks) {
    const parsed = safeJsonParse(chunk.data);
    const obj = getRecord(parsed);
    if (!obj) {
      continue;
    }

    const sessionId =
      getString(getRecord(obj.properties)?.sessionID) ??
      getString(obj.sessionID);
    if (sessionId && sessionId.length > 0) {
      return sessionId;
    }
  }
  return null;
}
