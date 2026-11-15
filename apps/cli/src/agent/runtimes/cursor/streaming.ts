import { isRecord } from "../../sdk/adapters/adapter-interface.js";
import type { ChunkStreamPolicy, ContentChunk } from "../contracts.js";

// `text` (2026.07+ builds) shares thinking's flat `{subtype, text}` shape.
const COALESCIBLE_CHUNK_TYPES = new Set(["assistant", "thinking", "text"]);
const FLAT_TEXT_CHUNK_TYPES = new Set(["thinking", "text"]);

function safeJsonParse(data: string): unknown | null {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function getMessageText(event: Record<string, unknown>): string | null {
  const message = event.message;
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return null;
  }
  const parts: string[] = [];
  for (const item of message.content) {
    if (!isRecord(item) || item.type !== "text" || typeof item.text !== "string") {
      return null;
    }
    parts.push(item.text);
  }
  return parts.join("");
}

/**
 * Flush-buffer policy for cursor-agent streaming: `assistant` and `thinking` arrive as
 * micro-chunks with no final aggregated message, so consecutive same-type chunks merge
 * within a flush window — per-token rows have no rendering value and multiply Convex
 * writes. The web normalizer then emits whole events per chunk.
 */
export const cursorChunkStreamPolicy: ChunkStreamPolicy = {
  isDeferrable(chunk: ContentChunk): boolean {
    return COALESCIBLE_CHUNK_TYPES.has(chunk.type);
  },

  coalesce(prev: ContentChunk, next: ContentChunk): ContentChunk | null {
    if (prev.type !== next.type) {
      return null;
    }
    const prevParsed = safeJsonParse(prev.data);
    const nextParsed = safeJsonParse(next.data);
    if (!isRecord(prevParsed) || !isRecord(nextParsed)) {
      return null;
    }

    if (FLAT_TEXT_CHUNK_TYPES.has(prev.type)) {
      if (
        typeof prevParsed.text !== "string" ||
        typeof nextParsed.text !== "string"
      ) {
        return null;
      }
      return {
        type: prev.type,
        data: JSON.stringify({
          ...prevParsed,
          text: prevParsed.text + nextParsed.text,
        }),
      };
    }

    // assistant: merge the concatenated message text into a single item.
    const prevText = getMessageText(prevParsed);
    const nextText = getMessageText(nextParsed);
    if (prevText === null || nextText === null) {
      return null;
    }
    const prevMessage = isRecord(prevParsed.message) ? prevParsed.message : {};
    return {
      type: prev.type,
      data: JSON.stringify({
        ...prevParsed,
        message: {
          ...prevMessage,
          content: [{ type: "text", text: prevText + nextText }],
        },
      }),
    };
  },

  text(chunk: ContentChunk): string | null {
    const parsed = COALESCIBLE_CHUNK_TYPES.has(chunk.type) ? safeJsonParse(chunk.data) : null;
    if (!isRecord(parsed)) return null;
    if (!FLAT_TEXT_CHUNK_TYPES.has(chunk.type)) return getMessageText(parsed);
    return typeof parsed.text === "string" ? parsed.text : null;
  },

  withText(chunk: ContentChunk, text: string): ContentChunk {
    const parsed = safeJsonParse(chunk.data);
    if (!isRecord(parsed)) return chunk;
    if (FLAT_TEXT_CHUNK_TYPES.has(chunk.type)) return { type: chunk.type, data: JSON.stringify({ ...parsed, text }) };
    const message = isRecord(parsed.message) ? parsed.message : {};
    return { type: chunk.type, data: JSON.stringify({ ...parsed, message: { ...message, content: [{ type: "text", text }] } }) };
  },
};
