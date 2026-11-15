import { isRecord } from "../../sdk/adapters/adapter-interface.js";

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function extractClaudeCodeContinuationId(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const direct = stringField(payload, "session_id") ?? stringField(payload, "sessionId");
  if (direct) {
    return direct;
  }

  const message = payload.message;
  if (isRecord(message)) {
    const nested = stringField(message, "session_id") ?? stringField(message, "sessionId");
    if (nested) {
      return nested;
    }
  }

  const result = payload.result;
  if (isRecord(result)) {
    const nested = stringField(result, "session_id") ?? stringField(result, "sessionId");
    if (nested) {
      return nested;
    }
  }

  return undefined;
}
