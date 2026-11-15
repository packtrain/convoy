import { isRecord } from "../../sdk/adapters/adapter-interface.js";
import type { ChunkStreamPolicy, ContentChunk } from "../contracts.js";

const DELTA_CHUNK_TYPES = new Set(["item/plan/delta", "item/agentMessage/delta", "item/reasoning/textDelta", "item/reasoning/summaryTextDelta"]);

function safeJsonParse(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function parseDelta(chunk: ContentChunk): (Record<string, unknown> & { itemId: string; delta: string }) | null {
  const parsed = safeJsonParse(chunk.data);
  if (!isRecord(parsed) || typeof parsed.itemId !== "string" || typeof parsed.delta !== "string") {
    return null;
  }
  return { ...parsed, itemId: parsed.itemId, delta: parsed.delta };
}

/**
 * Flush-buffer policy for `codex app-server` partial streaming: deltas arrive
 * per token, so consecutive deltas for the same item merge into one chunk
 * (per-token rows have no rendering value and multiply Convex writes — OS-1761).
 */
export const codexChunkStreamPolicy: ChunkStreamPolicy = {
  isDeferrable(chunk: ContentChunk): boolean {
    if (chunk.type === "convoy/child") {
      const parsed = safeJsonParse(chunk.data);
      return isRecord(parsed) && typeof parsed.method === "string" && DELTA_CHUNK_TYPES.has(parsed.method);
    }
    return DELTA_CHUNK_TYPES.has(chunk.type);
  },

  coalesce(prev: ContentChunk, next: ContentChunk): ContentChunk | null {
    if (prev.type !== next.type) {
      return null;
    }
    if (prev.type === "convoy/child") {
      const first = safeJsonParse(prev.data);
      const second = safeJsonParse(next.data);
      if (!isRecord(first) || !isRecord(second) || typeof first.method !== "string" ||
        first.method !== second.method || !DELTA_CHUNK_TYPES.has(first.method) ||
        JSON.stringify(first.source) !== JSON.stringify(second.source)) return null;
      const merged = codexChunkStreamPolicy.coalesce(
        { type: first.method, data: JSON.stringify(first.params) },
        { type: first.method, data: JSON.stringify(second.params) },
      );
      return merged ? { type: prev.type, data: JSON.stringify({ ...first, params: safeJsonParse(merged.data) }) } : null;
    }
    const prevParsed = parseDelta(prev);
    const nextParsed = parseDelta(next);
    if (!prevParsed || !nextParsed || prevParsed.itemId !== nextParsed.itemId ||
      prevParsed.threadId !== nextParsed.threadId || prevParsed.turnId !== nextParsed.turnId) {
      return null;
    }

    return {
      type: prev.type,
      data: JSON.stringify({
        ...prevParsed,
        delta: prevParsed.delta + nextParsed.delta,
      }),
    };
  },

  text(chunk: ContentChunk): string | null {
    if (chunk.type !== "convoy/child") return parseDelta(chunk)?.delta ?? null;
    const parsed = safeJsonParse(chunk.data);
    return isRecord(parsed) && typeof parsed.method === "string" && isRecord(parsed.params)
      ? codexChunkStreamPolicy.text({ type: parsed.method, data: JSON.stringify(parsed.params) })
      : null;
  },

  withText(chunk: ContentChunk, text: string): ContentChunk {
    const parsed = safeJsonParse(chunk.data);
    if (!isRecord(parsed)) return chunk;
    if (chunk.type !== "convoy/child") return { type: chunk.type, data: JSON.stringify({ ...parsed, delta: text }) };
    return isRecord(parsed.params)
      ? { type: chunk.type, data: JSON.stringify({ ...parsed, params: { ...parsed.params, delta: text } }) }
      : chunk;
  },

  stream(chunk: ContentChunk): string {
    if (chunk.type !== "convoy/child") return "";
    const parsed = safeJsonParse(chunk.data);
    return isRecord(parsed) ? JSON.stringify(parsed.source) ?? "child" : "child";
  },
};
