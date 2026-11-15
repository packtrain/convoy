import { describe, expect, test } from "vitest";
import {
  getCursorContinuationIdFromIncomingChunks,
  normalizeCursorChunk,
} from "./normalizeChunk";

function chunk(payload: Record<string, unknown>) {
  const type = typeof payload.type === "string" ? payload.type : "unknown";
  return { type, data: JSON.stringify(payload) };
}

describe("normalizeCursorChunk", () => {
  test("system init is silent metadata without a sessionId", () => {
    const event = normalizeCursorChunk(
      chunk({
        type: "system",
        subtype: "init",
        session_id: "sess-123",
        model: "OpenAI GPT-5",
        permissionMode: "default",
      }),
    );
    expect(event.kind).toBe("metadata");
    if (event.kind === "metadata") {
      expect(event.sessionId).toBeUndefined();
      expect(JSON.parse(event.otherJson ?? "{}")).toMatchObject({
        event: "init",
        model: "OpenAI GPT-5",
      });
    }
  });

  test("user echo is metadata carrying the session id", () => {
    const event = normalizeCursorChunk(
      chunk({
        type: "user",
        session_id: "sess-123",
        message: { role: "user", content: [{ type: "text", text: "hi" }] },
      }),
    );
    expect(event).toMatchObject({ kind: "metadata", sessionId: "sess-123" });
  });

  test("assistant micro-chunk becomes a whole text event", () => {
    expect(
      normalizeCursorChunk(
        chunk({
          type: "assistant",
          session_id: "sess-123",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Hel" },
              { type: "text", text: "lo" },
            ],
          },
        }),
      ),
    ).toEqual({ kind: "text", text: "Hello" });
  });

  test("empty assistant chunk is silent metadata", () => {
    const event = normalizeCursorChunk(
      chunk({
        type: "assistant",
        message: { role: "assistant", content: [] },
      }),
    );
    expect(event.kind).toBe("metadata");
  });

  test("thinking becomes a reasoning event", () => {
    expect(
      normalizeCursorChunk(
        chunk({ type: "thinking", subtype: "delta", text: "pondering" }),
      ),
    ).toEqual({ kind: "reasoning", text: "pondering" });
    // The completed marker carries no text and stays silent.
    expect(
      normalizeCursorChunk(chunk({ type: "thinking", subtype: "completed" }))
        .kind,
    ).toBe("metadata");
  });

  test("flat text events (2026.07+ builds) become text events", () => {
    expect(
      normalizeCursorChunk(
        chunk({ type: "text", subtype: "delta", text: "Hello" }),
      ),
    ).toEqual({ kind: "text", text: "Hello" });
  });

  test("shell tool_call maps started to tool-input and completed to tool-output", () => {
    const started = normalizeCursorChunk(
      chunk({
        type: "tool_call",
        subtype: "started",
        call_id: "call-1",
        tool_call: {
          shellToolCall: {
            args: { command: "wc -l drill.md", workingDirectory: "", timeout: 0 },
          },
        },
      }),
    );
    expect(started).toMatchObject({
      kind: "tool-input",
      toolCallId: "call-1",
      toolName: "Shell",
    });
    if (started.kind === "tool-input") {
      expect(JSON.parse(started.inputJson)).toMatchObject({
        command: "wc -l drill.md",
      });
    }

    const completed = normalizeCursorChunk(
      chunk({
        type: "tool_call",
        subtype: "completed",
        call_id: "call-1",
        tool_call: {
          shellToolCall: {
            args: { command: "wc -l drill.md" },
            result: { success: { stdout: "12 drill.md", stderr: "", exitCode: 0 } },
          },
        },
      }),
    );
    expect(completed).toMatchObject({ kind: "tool-output", toolCallId: "call-1" });
  });

  test("failed shell tool_call maps to tool-error", () => {
    const event = normalizeCursorChunk(
      chunk({
        type: "tool_call",
        subtype: "completed",
        call_id: "call-2",
        tool_call: {
          shellToolCall: {
            args: { command: "false" },
            result: { failure: { stdout: "", stderr: "boom", exitCode: 1 } },
          },
        },
      }),
    );
    expect(event).toMatchObject({ kind: "tool-error", toolCallId: "call-2" });
  });

  test("mcp tool_call derives the tool name from provider and tool", () => {
    const event = normalizeCursorChunk(
      chunk({
        type: "tool_call",
        subtype: "started",
        call_id: "call-3",
        tool_call: {
          mcpToolCall: {
            args: {
              name: "search",
              providerIdentifier: "contoso",
              toolName: "search_tasks",
            },
          },
        },
      }),
    );
    expect(event).toMatchObject({
      kind: "tool-input",
      toolName: "contoso.search_tasks",
    });
  });

  test("unknown tool wrapper key falls back to the raw key", () => {
    const event = normalizeCursorChunk(
      chunk({
        type: "tool_call",
        subtype: "started",
        call_id: "call-4",
        tool_call: { fancyNewToolCall: { args: { foo: "bar" } } },
      }),
    );
    expect(event).toMatchObject({
      kind: "tool-input",
      toolName: "fancyNewToolCall",
    });
  });

  test("result with is_error becomes a runtime notice", () => {
    const event = normalizeCursorChunk(
      chunk({
        type: "result",
        subtype: "error",
        is_error: true,
        result: "Model overloaded",
        session_id: "sess-123",
      }),
    );
    expect(event).toMatchObject({
      kind: "runtime-notice",
      code: "cursor-run-failed",
      message: "Model overloaded",
    });
  });

  test("successful result is silent metadata", () => {
    const event = normalizeCursorChunk(
      chunk({
        type: "result",
        subtype: "success",
        is_error: false,
        duration_ms: 1234,
        result: "done",
      }),
    );
    expect(event.kind).toBe("metadata");
  });

  test("synthetic commands inventory is silent metadata", () => {
    expect(
      normalizeCursorChunk({
        type: "convoy.commands",
        data: JSON.stringify({ commands: ["plan"] }),
      }).kind,
    ).toBe("metadata");
  });

  test("unrecognized events and unparseable data map to unknown", () => {
    expect(
      normalizeCursorChunk(chunk({ type: "mystery", session_id: "x" })),
    ).toMatchObject({ kind: "unknown", reason: "unrecognized-cursor-event" });
    expect(
      normalizeCursorChunk({ type: "assistant", data: "not-json" }),
    ).toMatchObject({ kind: "unknown", reason: "unparseable-cursor-chunk" });
  });
});

describe("getCursorContinuationIdFromIncomingChunks", () => {
  test("skips system events and returns the first session id", () => {
    expect(
      getCursorContinuationIdFromIncomingChunks([
        chunk({ type: "system", subtype: "init", session_id: "stale" }),
        chunk({ type: "convoy.commands" }),
        chunk({
          type: "assistant",
          session_id: "sess-live",
          message: { role: "assistant", content: [] },
        }),
        chunk({ type: "result", session_id: "sess-later" }),
      ]),
    ).toBe("sess-live");
  });

  test("returns null when no non-system chunk carries a session id", () => {
    expect(
      getCursorContinuationIdFromIncomingChunks([
        chunk({ type: "system", subtype: "init", session_id: "stale" }),
        chunk({ type: "thinking", text: "hmm" }),
      ]),
    ).toBeNull();
  });
});
