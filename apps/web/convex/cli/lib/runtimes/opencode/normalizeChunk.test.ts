import { describe, expect, test } from "vitest";
import {
  getOpencodeContinuationIdFromIncomingChunks,
  isOpencodeEphemeralChunk,
  normalizeOpencodeChunk,
} from "./normalizeChunk";

function sdkChunk(type: string, properties: Record<string, unknown>) {
  return { type, data: JSON.stringify({ type, properties }) };
}

function partChunk(part: Record<string, unknown>, sessionID = "ses_1") {
  return sdkChunk("message.part.updated", {
    part: { sessionID, ...part },
  });
}

describe("normalizeOpencodeChunk", () => {
  test("normalizes completed-turn context snapshots as durable usage", () => {
    const chunk = { type: "convoy.context_usage", data: JSON.stringify({ usedTokens: 8650, maxTokens: 200_000 }) };
    expect(normalizeOpencodeChunk(chunk)).toEqual({ kind: "context-window", usedTokens: 8650, maxTokens: 200_000 });
    expect(isOpencodeEphemeralChunk(chunk)).toBe(false);
  });

  test.each([
    { usedTokens: 0, maxTokens: 200_000 },
    { usedTokens: 100, maxTokens: 0 },
    { usedTokens: -1, maxTokens: 200_000 },
    { usedTokens: 100 },
    { usedTokens: "100", maxTokens: 200_000 },
  ])("ignores invalid context snapshots: %j", (snapshot) => {
    expect(normalizeOpencodeChunk({ type: "convoy.context_usage", data: JSON.stringify(snapshot) }).kind).toBe("metadata");
  });

  test("completed text part becomes a text event", () => {
    expect(
      normalizeOpencodeChunk(
        partChunk({
          id: "prt_1",
          type: "text",
          text: "hello world",
          time: { start: 1, end: 2 },
        }),
      ),
    ).toEqual({ kind: "text", text: "hello world" });
  });

  test("in-flight text snapshot stays silent metadata", () => {
    const event = normalizeOpencodeChunk(
      partChunk({
        id: "prt_1",
        type: "text",
        text: "hel",
        time: { start: 1 },
      }),
    );
    expect(event).toMatchObject({ kind: "metadata", sessionId: "ses_1" });
  });

  test("completed reasoning part becomes a reasoning event", () => {
    expect(
      normalizeOpencodeChunk(
        partChunk({
          id: "prt_2",
          type: "reasoning",
          text: "thinking...",
          time: { start: 1, end: 2 },
        }),
      ),
    ).toEqual({ kind: "reasoning", text: "thinking..." });
  });

  test("empty completed reasoning stays silent", () => {
    expect(
      normalizeOpencodeChunk(
        partChunk({
          id: "prt_2",
          type: "reasoning",
          text: "",
          time: { start: 1, end: 2 },
        }),
      ).kind,
    ).toBe("metadata");
  });

  test("running tool part maps to tool-input", () => {
    expect(
      normalizeOpencodeChunk(
        partChunk({
          id: "prt_3",
          type: "tool",
          tool: "bash",
          callID: "call_1",
          state: { status: "running", input: { command: "ls -la" } },
        }),
      ),
    ).toEqual({
      kind: "tool-input",
      toolCallId: "call_1",
      toolName: "bash",
      inputJson: JSON.stringify({ command: "ls -la" }),
    });
  });

  test("completed tool part maps to tool-output", () => {
    expect(
      normalizeOpencodeChunk(
        partChunk({
          id: "prt_3",
          type: "tool",
          tool: "bash",
          callID: "call_1",
          state: {
            status: "completed",
            output: "total 32\n",
            title: "ls -la",
            time: { start: 1, end: 2 },
          },
        }),
      ),
    ).toEqual({
      kind: "tool-output",
      toolCallId: "call_1",
      outputJson: JSON.stringify({ output: "total 32\n", title: "ls -la" }),
    });
  });

  test("errored tool part maps to tool-error", () => {
    expect(
      normalizeOpencodeChunk(
        partChunk({
          id: "prt_4",
          type: "tool",
          tool: "edit",
          state: { status: "error", error: "file not found" },
        }),
      ),
    ).toEqual({
      kind: "tool-error",
      toolCallId: "prt_4",
      errorText: "file not found",
    });
  });

  test("pending tool part stays silent metadata", () => {
    expect(
      normalizeOpencodeChunk(
        partChunk({
          id: "prt_5",
          type: "tool",
          tool: "webfetch",
          state: { status: "pending" },
        }),
      ).kind,
    ).toBe("metadata");
  });

  test("step parts stay silent metadata", () => {
    expect(
      normalizeOpencodeChunk(partChunk({ id: "prt_6", type: "step-start" })).kind,
    ).toBe("metadata");
    expect(
      normalizeOpencodeChunk(
        partChunk({
          id: "prt_7",
          type: "step-finish",
          tokens: { input: 10, output: 2 },
        }),
      ).kind,
    ).toBe("metadata");
  });

  test("text deltas normalize to ephemeral text-delta events", () => {
    const chunk = {
      type: "text.delta",
      data: JSON.stringify({ sessionID: "ses_1", text: "lo wor" }),
    };
    expect(normalizeOpencodeChunk(chunk)).toEqual({
      kind: "text-delta",
      text: "lo wor",
    });
    expect(isOpencodeEphemeralChunk(chunk)).toBe(true);
  });

  test("reasoning deltas normalize to ephemeral reasoning-delta events", () => {
    const chunk = {
      type: "reasoning.delta",
      data: JSON.stringify({ sessionID: "ses_1", text: "hmm" }),
    };
    expect(normalizeOpencodeChunk(chunk)).toEqual({
      kind: "reasoning-delta",
      text: "hmm",
    });
    expect(isOpencodeEphemeralChunk(chunk)).toBe(true);
  });

  test("final SDK events are not ephemeral", () => {
    expect(
      isOpencodeEphemeralChunk(
        partChunk({ id: "prt_1", type: "text", time: { end: 2 } }),
      ),
    ).toBe(false);
  });

  test("session retry status becomes a warning", () => {
    expect(
      normalizeOpencodeChunk(
        sdkChunk("session.status", {
          sessionID: "ses_1",
          status: { type: "retry", message: "provider overloaded" },
        }),
      ),
    ).toEqual({
      kind: "warning",
      code: "opencode-retry",
      message: "provider overloaded",
    });
  });

  test("idle session status stays silent metadata with sessionId", () => {
    expect(
      normalizeOpencodeChunk(
        sdkChunk("session.status", {
          sessionID: "ses_1",
          status: { type: "idle" },
        }),
      ),
    ).toMatchObject({ kind: "metadata", sessionId: "ses_1" });
  });

  test("session errors become warnings with the provider message", () => {
    expect(
      normalizeOpencodeChunk(
        sdkChunk("session.error", {
          sessionID: "ses_1",
          error: { name: "ProviderError", data: { message: "quota exceeded" } },
        }),
      ),
    ).toEqual({
      kind: "warning",
      code: "opencode-session-error",
      message: "quota exceeded",
    });
  });

  test("message envelope and reply events stay silent metadata", () => {
    for (const type of [
      "message.updated",
      "message.removed",
      "permission.replied",
      "question.replied",
      "question.rejected",
    ]) {
      expect(
        normalizeOpencodeChunk(sdkChunk(type, { sessionID: "ses_1" })).kind,
      ).toBe("metadata");
    }
  });

  test("the synthetic convoy.commands inventory chunk is silent metadata", () => {
    expect(
      normalizeOpencodeChunk({
        type: "convoy.commands",
        data: JSON.stringify({ commands: ["init", "commit"] }),
      }).kind,
    ).toBe("metadata");
  });

  // OS-1614: `/compact` streams as an ordinary turn; this event is the
  // confirmation row, so it must not read as an unknown event.
  test("session.compacted renders as a context-compaction row", () => {
    const result = normalizeOpencodeChunk(
      sdkChunk("session.compacted", { sessionID: "ses_1" }),
    );

    expect(result.kind).toBe("context-compaction");
    if (result.kind === "context-compaction") {
      expect(result.message).toBe("Conversation compacted");
      expect(result.inProgress).toBeUndefined();
    }
  });

  test("unknown events and malformed payloads fall back to unknown", () => {
    expect(normalizeOpencodeChunk(sdkChunk("something.new", {})).kind).toBe(
      "unknown",
    );
    expect(
      normalizeOpencodeChunk({ type: "message.part.updated", data: "not json" })
        .kind,
    ).toBe("unknown");
    expect(
      normalizeOpencodeChunk(sdkChunk("message.part.updated", {})).kind,
    ).toBe("unknown");
  });
});

describe("getOpencodeContinuationIdFromIncomingChunks", () => {
  test("finds the session id from SDK event properties", () => {
    expect(
      getOpencodeContinuationIdFromIncomingChunks([
        { type: "message.updated", data: "not json" },
        sdkChunk("session.status", {
          sessionID: "ses_42",
          status: { type: "busy" },
        }),
      ]),
    ).toBe("ses_42");
  });

  test("finds the session id from synthesized delta chunks", () => {
    expect(
      getOpencodeContinuationIdFromIncomingChunks([
        {
          type: "text.delta",
          data: JSON.stringify({ sessionID: "ses_7", text: "hi" }),
        },
      ]),
    ).toBe("ses_7");
  });

  test("returns null when absent", () => {
    expect(
      getOpencodeContinuationIdFromIncomingChunks([
        { type: "message.updated", data: JSON.stringify({ properties: {} }) },
      ]),
    ).toBeNull();
  });
});
