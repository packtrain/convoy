import type { Doc } from "../../../_generated/dataModel";
import { ensure } from "../../../lib/shared/ensure";
import { errors } from "../../errors";
import { isPossiblyShortenedChunkData } from "./invariants";

/** Validate separately; retain number tokens, duplicate keys and string escapes. */
function compactJson(data: string): string {
  JSON.parse(data);
  return data.replace(/"(?:[^"\\]|\\[\s\S])*"|[ \t\r\n]+/g, token => token[0] === '"' ? token : "");
}

export function toRawRunLogRow(row: Pick<Doc<"cliMessageChunks">, "type" | "data" | "chunkOrder">, fragment: boolean, offset = 0) {
  let json: string;
  let fidelity = "stored; original completeness unknown";
  try { json = compactJson(row.data); }
  catch {
    json = JSON.stringify({ type: row.type, data: row.data });
    fidelity = "stored non-JSON data; original completeness unknown";
  }
  if (isPossiblyShortenedChunkData(row.data)) fidelity = "possibly shortened before storage";
  const bytes = new TextEncoder().encode(json).length;
  ensure(offset).between(0, json.length, errors.SERVICE_LOG_CURSOR_INVALID);
  // 16K UTF-16 units fit the service frame after escaping. See cli-tui.md.
  let end = fragment ? Math.min(json.length, offset + 16_384) : json.length <= 4096 ? json.length : 0;
  if (end > offset && end < json.length && json.charCodeAt(end - 1) >= 0xd800 && json.charCodeAt(end - 1) <= 0xdbff) end--;
  return { order: row.chunkOrder, eventJson: json.slice(offset, end), truncated: false, bytes, length: json.length,
    ...(end < json.length ? { nextOffset: end } : {}), fidelity };
}
