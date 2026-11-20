import { isRecord } from "../../sdk/adapters/adapter-interface.js";
import type { ChunkStreamPolicy, ContentChunk } from "../contracts.js";

/** Longest tail kept of any string in a tool payload (t3code keeps the same). */
export const MAX_TOOL_STRING_CHARS = 8_000;

const DELTA_UPDATES = new Set(["agent_message_chunk", "agent_thought_chunk"]);

function parseDelta(chunk: ContentChunk): { params: Record<string, unknown>; kind: string; text: string } | null {
  if (chunk.type !== "session/update") return null;
  let params: unknown;
  try {
    params = JSON.parse(chunk.data);
  } catch {
    return null;
  }
  const update = isRecord(params) && isRecord(params.update) ? params.update : null;
  const kind = typeof update?.sessionUpdate === "string" ? update.sessionUpdate : "";
  const content = isRecord(update?.content) ? update.content : null;
  if (!isRecord(params) || !DELTA_UPDATES.has(kind) || typeof content?.text !== "string") return null;
  return { params, kind, text: content.text };
}

function withDeltaText(params: Record<string, unknown>, text: string): ContentChunk {
  const update = params.update as Record<string, unknown>;
  return {
    type: "session/update",
    data: JSON.stringify({ ...params, update: { ...update, content: { type: "text", text } } }),
  };
}

/** Message and thought chunks are deltas: they wait for a flush window and merge per kind. */
export const antigravityChunkStreamPolicy: ChunkStreamPolicy = {
  isDeferrable: (chunk) => parseDelta(chunk) !== null,
  coalesce(prev, next) {
    const a = parseDelta(prev);
    const b = parseDelta(next);
    return a && b && a.kind === b.kind ? withDeltaText(a.params, a.text + b.text) : null;
  },
  text: (chunk) => parseDelta(chunk)?.text ?? null,
  withText(chunk, text) {
    const delta = parseDelta(chunk);
    return delta ? withDeltaText(delta.params, text) : chunk;
  },
};

function boundStrings(value: unknown): unknown {
  if (typeof value === "string") {
    // The marker keeps a clipped file or command from rendering as the whole thing.
    return value.length > MAX_TOOL_STRING_CHARS
      ? `[${value.length - MAX_TOOL_STRING_CHARS} characters omitted]\n${value.slice(-MAX_TOOL_STRING_CHARS)}`
      : value;
  }
  if (Array.isArray(value)) return value.map(boundStrings);
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, boundStrings(entry)]));
  return value;
}

/**
 * Tool update as sent to Convex: agy repeats `rawInput` as `args` and a command's
 * `rawOutput.output` as a text content block, so both copies are dropped before bounding.
 */
export function compactToolUpdate(update: Record<string, unknown>): Record<string, unknown> {
  const { args: _args, ...rest } = update;
  const output = isRecord(update.rawOutput) ? update.rawOutput.output : undefined;
  if (Array.isArray(rest.content) && typeof output === "string") {
    rest.content = rest.content.filter(
      (entry) => !(isRecord(entry) && entry.type === "content" && isRecord(entry.content) && entry.content.text === output)
    );
  }
  return boundStrings(rest) as Record<string, unknown>;
}
