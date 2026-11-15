import { TRUNCATED_STRING_NOTICE } from "../runtimes/shared/scrubChunk";

// Storage includes raw and normalized payloads. See docs/specs/cli-tui.md.
export const MAX_CHUNK_DATA_CHARS = 100_000;

export function isPossiblyShortenedChunkData(data: string): boolean {
  return data.length >= MAX_CHUNK_DATA_CHARS - 1 || data.includes(TRUNCATED_STRING_NOTICE);
}
