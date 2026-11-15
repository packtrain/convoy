import { expandCliNormalizedEvent } from "../../chunks/normalizedEvents";
import { normalizeClaudeCodeChunk } from "./normalizeChunk";

type RawChunk = {
  type: string;
  data: string;
};

export function getClaudeCodeContinuationIdFromIncomingChunks(
  incomingChunks: RawChunk[],
): string | null {
  for (const chunk of incomingChunks) {
    const normalizedEvent = normalizeClaudeCodeChunk(chunk);

    for (const event of expandCliNormalizedEvent(normalizedEvent)) {
      if (event.kind === "metadata" && event.sessionId) {
        return event.sessionId;
      }
    }
  }

  return null;
}
