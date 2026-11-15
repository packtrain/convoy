import type { ChunkStreamPolicy, ContentChunk } from "../contracts.js";
import { getRecord, safeJsonParse } from "./json.js";

const DELTA_CHUNK_TYPES = new Set(["text.delta", "reasoning.delta"]);

type ParsedDelta = {
  sessionID: string;
  partID: string;
  text: string;
};

function parseDeltaChunk(chunk: ContentChunk): ParsedDelta | null {
  if (!DELTA_CHUNK_TYPES.has(chunk.type)) {
    return null;
  }
  const parsed = getRecord(safeJsonParse(chunk.data));
  if (
    !parsed ||
    typeof parsed.sessionID !== "string" ||
    typeof parsed.partID !== "string" ||
    typeof parsed.text !== "string"
  ) {
    return null;
  }
  return { sessionID: parsed.sessionID, partID: parsed.partID, text: parsed.text };
}

/**
 * Flush-buffer policy for OpenCode partial streaming: delta chunks may wait
 * for a flush window; consecutive deltas for the same part merge into one
 * chunk (per-token rows have no rendering value and multiply Convex writes).
 */
export const opencodeChunkStreamPolicy: ChunkStreamPolicy = {
  isDeferrable(chunk: ContentChunk): boolean {
    return DELTA_CHUNK_TYPES.has(chunk.type);
  },

  coalesce(prev: ContentChunk, next: ContentChunk): ContentChunk | null {
    if (prev.type !== next.type) {
      return null;
    }
    const prevParsed = parseDeltaChunk(prev);
    const nextParsed = parseDeltaChunk(next);
    if (
      !prevParsed ||
      !nextParsed ||
      prevParsed.partID !== nextParsed.partID ||
      prevParsed.sessionID !== nextParsed.sessionID
    ) {
      return null;
    }

    return {
      type: prev.type,
      data: JSON.stringify({
        sessionID: prevParsed.sessionID,
        partID: prevParsed.partID,
        text: prevParsed.text + nextParsed.text,
      }),
    };
  },

  text(chunk: ContentChunk): string | null {
    return parseDeltaChunk(chunk)?.text ?? null;
  },

  withText(chunk: ContentChunk, text: string): ContentChunk {
    const parsed = getRecord(safeJsonParse(chunk.data));
    return parsed ? { type: chunk.type, data: JSON.stringify({ ...parsed, text }) } : chunk;
  },
};
