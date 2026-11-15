import { boundBackgroundTasks } from "../runtimes/validators.js";
import type { ContentChunk } from "../runtimes/contracts.js";
import { isRecord } from "../sdk/adapters/adapter-interface.js";

/**
 * Mirrors the server-side chunk-row storage budget (`chunks/store.ts`
 * MAX_CHUNK_DATA_CHARS). Chunks above it are scrubbed or truncated before upload: a tool
 * result that inlines a whole file (Claude's Read of an image embeds base64) would
 * otherwise ship megabytes per chunk and blow Convex's limits, killing the stream
 * (OS-1521). The server applies the same scrub at insert time as a backstop for older
 * CLIs.
 */
const MAX_CHUNK_DATA_CHARS = 100_000;

// Keep in sync with apps/web/convex/cli/lib/runtimes/shared/scrubChunk.ts —
// the CLI ships standalone with no shared package, so the scrub is
// duplicated here verbatim.

const TRUNCATED_STRING_NOTICE = "… [truncated: payload too large to store]";

/**
 * Base64 payloads above this size are dropped outright at every cap rung: a
 * clamped base64 string is unrenderable garbage, so keeping a prefix only
 * wastes budget. Small inline blobs are left alone.
 */
const BASE64_DROP_CHARS = 25_000;

/**
 * Per-string cap rungs as fractions of the chunk budget, widest first — the first rung
 * that fits wins, so a barely-over chunk keeps most of a large string. The top rung stays
 * under 1 so a single dominant string can still be clamped.
 */
const STRING_CAP_RUNGS = [0.9, 0.5, 0.25];

function clampString(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  let end = maxChars;
  // Never split a surrogate pair: a lone surrogate is not valid Unicode.
  const lastCode = value.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    end -= 1;
  }
  return value.slice(0, end) + TRUNCATED_STRING_NOTICE;
}

function isDroppableBase64(key: string, entry: unknown): boolean {
  return (
    key === "base64" &&
    typeof entry === "string" &&
    entry.length > BASE64_DROP_CHARS
  );
}

function scrubValue(value: unknown, maxStringChars: number): unknown {
  if (typeof value === "string") {
    return clampString(value, maxStringChars);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrubValue(entry, maxStringChars));
  }
  if (isRecord(value)) {
    // Anthropic image source block: { type: "base64", data: "<huge>" }.
    // Drop the payload, keep the wrapper (media_type etc.) so the block
    // stays recognizable.
    if (
      value.type === "base64" &&
      typeof value.data === "string" &&
      value.data.length > BASE64_DROP_CHARS
    ) {
      return { ...value, data: "" };
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        // Claude's tool_use_result inlines the same image again as
        // `file.base64` — no type:"base64" wrapper, so match on the key.
        isDroppableBase64(key, entry) ? "" : scrubValue(entry, maxStringChars),
      ])
    );
  }
  return value;
}

/**
 * Scrub for an oversized chunk payload: a structural JSON walk with a base64-block
 * heuristic. Base64 payloads are dropped and other huge strings clamped with a notice,
 * keeping valid JSON. Null when the data is not a JSON object or still over budget at the
 * tightest rung; the caller then raw-truncates.
 *
 * ponytail: rungs assume a few huge strings dominate; many-medium-strings payloads fall
 * through to truncation.
 */
function scrubOversizedChunkData(
  data: string,
  maxDataChars: number
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  for (const rung of STRING_CAP_RUNGS) {
    const scrubbed = JSON.stringify(
      scrubValue(parsed, Math.floor(maxDataChars * rung))
    );
    if (scrubbed.length <= maxDataChars) {
      return scrubbed;
    }
  }
  return null;
}

function truncateChunkData(data: string): string {
  let end = MAX_CHUNK_DATA_CHARS;
  // Never split a surrogate pair: a lone surrogate is not valid Unicode.
  const lastCode = data.charCodeAt(end - 1);
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    end -= 1;
  }
  return data.slice(0, end);
}

/**
 * Keep every outgoing chunk under the server's storage budget: scrubbed into
 * valid smaller JSON when possible, else raw-truncated — the same
 * scrub-then-truncate contract the server applies at insert time. Without
 * the hard bound, a flush batch of oversized chunks can exceed Convex's
 * function-argument limit and kill the stream (OS-1521).
 */
export function scrubOversizedChunk(chunk: ContentChunk): ContentChunk {
  if (chunk.type === "convoy/background_tasks" || chunk.type === "system") {
    try {
      const parsed: unknown = JSON.parse(chunk.data);
      if (isRecord(parsed) && (chunk.type === "convoy/background_tasks" || parsed.subtype === "background_tasks_changed")) {
        const bounded = boundBackgroundTasks(parsed);
        if (bounded) return { ...chunk, data: JSON.stringify(bounded) };
      }
    } catch { /* Malformed chunks retain the generic scrub behavior. */ }
  }
  if (chunk.data.length <= MAX_CHUNK_DATA_CHARS) {
    return chunk;
  }
  const scrubbed = scrubOversizedChunkData(chunk.data, MAX_CHUNK_DATA_CHARS);
  return { ...chunk, data: scrubbed ?? truncateChunkData(chunk.data) };
}
