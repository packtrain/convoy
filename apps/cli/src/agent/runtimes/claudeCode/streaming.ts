import type { ChunkStreamPolicy, ContentChunk } from "../contracts.js";
import { isRecord } from "../../sdk/adapters/adapter-interface.js";

const COALESCIBLE_DELTA_TYPES = new Set(["text_delta", "thinking_delta", "input_json_delta"]);

type ParsedStreamEvent = {
  message: Record<string, unknown>;
  event: Record<string, unknown>;
  delta: Record<string, unknown>;
  blockIndex: number;
  deltaType: string;
  parentToolUseId: string | null;
  sessionId: string | null;
};

function parseCoalescibleStreamEvent(
  chunk: ContentChunk
): ParsedStreamEvent | null {
  if (chunk.type !== "stream_event") {
    return null;
  }

  let message: unknown;
  try {
    message = JSON.parse(chunk.data);
  } catch {
    return null;
  }

  if (!isRecord(message) || !isRecord(message.event)) {
    return null;
  }

  const event = message.event;
  if (event.type !== "content_block_delta") {
    return null;
  }

  const delta = event.delta;
  if (
    !isRecord(delta) ||
    typeof delta.type !== "string" ||
    !COALESCIBLE_DELTA_TYPES.has(delta.type) ||
    typeof event.index !== "number"
  ) {
    return null;
  }

  return {
    message,
    event,
    delta,
    blockIndex: event.index,
    deltaType: delta.type,
    parentToolUseId:
      typeof message.parent_tool_use_id === "string"
        ? message.parent_tool_use_id
        : null,
    sessionId:
      typeof message.session_id === "string" ? message.session_id : null,
  };
}

/** Redacted-thinking progress with nothing to render: never sent upstream. */
export function isSilentThinkingFrame(record: Record<string, unknown>): boolean {
  if (record.type === "system") {
    return record.subtype === "thinking_tokens";
  }
  if (record.type !== "stream_event" || !isRecord(record.event)) {
    return false;
  }
  const delta = record.event.delta;
  return isRecord(delta) && delta.type === "thinking_delta" && delta.thinking === "";
}

function textField(deltaType: string): string {
  return deltaType === "thinking_delta" ? "thinking" : deltaType === "input_json_delta" ? "partial_json" : "text";
}

function getDeltaText(delta: Record<string, unknown>): string | null {
  const value = delta[textField(String(delta.type))];
  return typeof value === "string" ? value : null;
}

function withDeltaText(parsed: ParsedStreamEvent, text: string): ContentChunk {
  const message = {
    ...parsed.message,
    event: { ...parsed.event, delta: { ...parsed.delta, [textField(parsed.deltaType)]: text } },
  };
  return { type: "stream_event", data: JSON.stringify(message) };
}

/**
 * Flush-buffer policy for Claude Code partial streaming: `stream_event`
 * chunks may wait for a flush window; consecutive text/thinking deltas for
 * the same content block merge into one chunk (per-token rows have no
 * rendering value and would multiply Convex writes).
 */
export const claudeCodeChunkStreamPolicy: ChunkStreamPolicy = {
  isDeferrable(chunk: ContentChunk): boolean {
    return chunk.type === "stream_event";
  },

  coalesce(prev: ContentChunk, next: ContentChunk): ContentChunk | null {
    const prevParsed = parseCoalescibleStreamEvent(prev);
    const nextParsed = parseCoalescibleStreamEvent(next);
    // Same content block AND same stream identity: merging across different
    // parent_tool_use_id/session_id would misattribute text (e.g. subagent
    // output rendered as top-level text) since the merged chunk keeps the
    // previous message's wrapper metadata.
    if (
      !prevParsed ||
      !nextParsed ||
      prevParsed.blockIndex !== nextParsed.blockIndex ||
      prevParsed.deltaType !== nextParsed.deltaType ||
      prevParsed.parentToolUseId !== nextParsed.parentToolUseId ||
      prevParsed.sessionId !== nextParsed.sessionId
    ) {
      return null;
    }

    const prevText = getDeltaText(prevParsed.delta);
    const nextText = getDeltaText(nextParsed.delta);
    if (prevText === null || nextText === null) {
      return null;
    }

    return withDeltaText(prevParsed, prevText + nextText);
  },

  text(chunk: ContentChunk): string | null {
    const parsed = parseCoalescibleStreamEvent(chunk);
    return parsed ? getDeltaText(parsed.delta) : null;
  },

  withText(chunk: ContentChunk, text: string): ContentChunk {
    const parsed = parseCoalescibleStreamEvent(chunk);
    return parsed ? withDeltaText(parsed, text) : chunk;
  },

  stream(chunk: ContentChunk): string {
    try {
      const message: unknown = JSON.parse(chunk.data);
      return isRecord(message) && typeof message.parent_tool_use_id === "string" ? message.parent_tool_use_id : "";
    } catch {
      return "";
    }
  },
};
