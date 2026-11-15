import { isRecord } from "@/lib/type-guards";

// Keep in sync with apps/cli/src/agent/app/chunk-scrub.ts — the CLI ships
// standalone with no shared package, so the scrub is duplicated there
// verbatim.

export const TRUNCATED_STRING_NOTICE = "… [truncated: payload too large to store]";

/**
 * Base64 payloads above this size are dropped outright at every cap rung: a
 * clamped base64 string is unrenderable garbage, so keeping a prefix only
 * wastes budget. Small inline blobs are left alone.
 */
const BASE64_DROP_CHARS = 25_000;

/**
 * Per-string cap rungs as fractions of the chunk budget, widest first — the first
 * rung that fits wins, so a barely-over chunk keeps most of a large string. The top
 * rung stays under 1 so a single dominant string can still be clamped.
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
      ]),
    );
  }
  return value;
}

/**
 * Scrub for an oversized chunk payload: a structural JSON walk with a base64-block
 * heuristic. Reading an image or big file inlines the whole payload in the chunk's
 * JSON, so base64 is dropped and other huge strings clamped with a notice — keeping
 * valid JSON, unlike raw truncation (OS-1521). Null when the data is not a JSON
 * object or still over budget at the tightest rung; callers then raw-truncate.
 *
 * ponytail: rungs assume a few huge strings dominate; many-medium-strings payloads
 * fall through to truncation.
 */
export function scrubOversizedChunkData(
  data: string,
  maxDataChars: number,
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
      scrubValue(parsed, Math.floor(maxDataChars * rung)),
    );
    if (scrubbed.length <= maxDataChars) {
      return scrubbed;
    }
  }
  return null;
}
