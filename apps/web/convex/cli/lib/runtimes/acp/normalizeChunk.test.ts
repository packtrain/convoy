import { describe, expect, test } from "vitest";
import {
  getAcpContinuationIdFromIncomingChunks,
  isAcpEphemeralChunk,
  normalizeAcpChunk,
} from "./normalizeChunk";

const update = (u: Record<string, unknown>) => ({
  type: "session/update",
  data: JSON.stringify({ sessionId: "s-1", update: u }),
});
const convoy = (type: string, data: Record<string, unknown>) => ({ type, data: JSON.stringify(data) });

describe("normalizeAcpChunk", () => {
  test("maps message and thought chunks to deltas and closed segments to whole text", () => {
    expect(normalizeAcpChunk(update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } }))).toEqual({
      kind: "text-delta",
      text: "Hi",
    });
    expect(normalizeAcpChunk(update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Hm" } }))).toEqual({
      kind: "reasoning-delta",
      text: "Hm",
    });
    expect(normalizeAcpChunk(convoy("convoy/acp_text", { sessionId: "s-1", text: "Hello" }))).toEqual({ kind: "text", text: "Hello" });
    expect(normalizeAcpChunk(convoy("convoy/acp_reasoning", { sessionId: "s-1", text: "Why" }))).toEqual({
      kind: "reasoning",
      text: "Why",
    });
  });

  test("maps a tool call to input, a completed update to output and a failed one to an error", () => {
    const call = { toolCallId: "call_1", kind: "fetch", title: "Fetch page", rawInput: { url: "https://x.test" } };
    expect(normalizeAcpChunk(update({ sessionUpdate: "tool_call", status: "in_progress", ...call }))).toEqual({
      kind: "tool-input",
      toolCallId: "call_1",
      toolName: "Fetch page",
      inputJson: JSON.stringify({ url: "https://x.test" }),
    });
    expect(
      normalizeAcpChunk(update({ sessionUpdate: "tool_call_update", status: "completed", ...call, content: [{ type: "content", content: { type: "text", text: "body" } }] }))
    ).toEqual({ kind: "tool-output", toolCallId: "call_1", outputJson: JSON.stringify("body") });
    expect(
      normalizeAcpChunk(update({ sessionUpdate: "tool_call_update", status: "failed", ...call, content: [{ type: "content", content: { type: "text", text: "404" } }] }))
    ).toEqual({ kind: "tool-error", toolCallId: "call_1", errorText: "404" });
    expect(normalizeAcpChunk(update({ sessionUpdate: "tool_call_update", status: "in_progress", ...call })).kind).toBe("metadata");
  });

  test("warns on a non-success stop reason and stays silent on end_turn and cancelled", () => {
    expect(normalizeAcpChunk(convoy("convoy/acp_prompt_result", { sessionId: "s-1", stopReason: "max_tokens" }))).toMatchObject({
      kind: "warning",
      code: "acp-max_tokens",
    });
    for (const stopReason of ["end_turn", "cancelled", "constructor"]) {
      expect(normalizeAcpChunk(convoy("convoy/acp_prompt_result", { sessionId: "s-1", stopReason })).kind).toBe("metadata");
    }
  });

  test("maps usage_update to the context window when both counts are positive", () => {
    // agy 1.5.13 sends `used: 0` right after session/new.
    expect(normalizeAcpChunk(update({ sessionUpdate: "usage_update", used: 8950, size: 1_048_576 }))).toEqual({
      kind: "context-window",
      usedTokens: 8950,
      maxTokens: 1_048_576,
    });
    for (const counts of [{ used: 0, size: 1_048_576 }, { used: 5 }, { used: "5", size: 10 }, { used: 5, size: -1 }]) {
      expect(normalizeAcpChunk(update({ sessionUpdate: "usage_update", ...counts })).kind).toBe("metadata");
    }
  });

  test("keeps known updates silent and flags anything else as unknown", () => {
    expect(normalizeAcpChunk(update({ sessionUpdate: "available_commands_update", availableCommands: [] })).kind).toBe("metadata");
    expect(normalizeAcpChunk(update({ sessionUpdate: "brand_new_update" }))).toMatchObject({
      kind: "unknown",
      reason: "unrecognized-acp-update",
    });
    expect(normalizeAcpChunk({ type: "other", data: "{}" })).toMatchObject({ kind: "unknown", reason: "unrecognized-acp-chunk" });
  });
});

describe("ACP chunk helpers", () => {
  test("only message and thought chunks are ephemeral", () => {
    expect(isAcpEphemeralChunk(update({ sessionUpdate: "agent_message_chunk", content: { text: "a" } }))).toBe(true);
    expect(isAcpEphemeralChunk(update({ sessionUpdate: "tool_call" }))).toBe(false);
    expect(isAcpEphemeralChunk(convoy("convoy/acp_text", { text: "a" }))).toBe(false);
  });

  test("the continuation id comes from the session marker", () => {
    expect(
      getAcpContinuationIdFromIncomingChunks([
        update({ sessionUpdate: "tool_call" }),
        convoy("convoy/acp_session", { sessionId: "s-9", agentVersion: "1.5.13" }),
      ])
    ).toBe("s-9");
    expect(getAcpContinuationIdFromIncomingChunks([update({ sessionUpdate: "tool_call" })])).toBeNull();
  });
});
