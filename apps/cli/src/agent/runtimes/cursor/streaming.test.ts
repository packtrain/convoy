import { describe, expect, it } from "vitest";
import { cursorChunkStreamPolicy } from "./streaming.js";

function assistantChunk(text: string, extra: Record<string, unknown> = {}) {
  return {
    type: "assistant",
    data: JSON.stringify({
      type: "assistant",
      session_id: "sess-1",
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
      },
      ...extra,
    }),
  };
}

describe("cursorChunkStreamPolicy", () => {
  it("defers assistant, thinking, and text micro-chunks only", () => {
    expect(
      cursorChunkStreamPolicy.isDeferrable({ type: "assistant", data: "{}" }),
    ).toBe(true);
    expect(
      cursorChunkStreamPolicy.isDeferrable({ type: "thinking", data: "{}" }),
    ).toBe(true);
    expect(
      cursorChunkStreamPolicy.isDeferrable({ type: "text", data: "{}" }),
    ).toBe(true);
    expect(
      cursorChunkStreamPolicy.isDeferrable({ type: "tool_call", data: "{}" }),
    ).toBe(false);
  });

  it("coalesces consecutive flat text chunks", () => {
    const merged = cursorChunkStreamPolicy.coalesce(
      {
        type: "text",
        data: JSON.stringify({ type: "text", subtype: "delta", text: "Hel" }),
      },
      {
        type: "text",
        data: JSON.stringify({ type: "text", subtype: "delta", text: "lo" }),
      },
    );
    expect(JSON.parse(merged?.data ?? "{}").text).toBe("Hello");
  });

  it("coalesces consecutive assistant chunks into one text item", () => {
    const merged = cursorChunkStreamPolicy.coalesce(
      assistantChunk("Hel"),
      assistantChunk("lo"),
    );
    expect(merged).not.toBeNull();
    const parsed = JSON.parse(merged?.data ?? "{}");
    expect(parsed.message.content).toEqual([{ type: "text", text: "Hello" }]);
    expect(parsed.session_id).toBe("sess-1");
  });

  it("coalesces consecutive thinking chunks by concatenating text", () => {
    const merged = cursorChunkStreamPolicy.coalesce(
      {
        type: "thinking",
        data: JSON.stringify({ type: "thinking", text: "pon", session_id: "s" }),
      },
      {
        type: "thinking",
        data: JSON.stringify({ type: "thinking", text: "der", session_id: "s" }),
      },
    );
    expect(JSON.parse(merged?.data ?? "{}").text).toBe("ponder");
  });

  it("refuses to merge across chunk types or malformed payloads", () => {
    expect(
      cursorChunkStreamPolicy.coalesce(assistantChunk("a"), {
        type: "thinking",
        data: JSON.stringify({ type: "thinking", text: "b" }),
      }),
    ).toBeNull();
    expect(
      cursorChunkStreamPolicy.coalesce(assistantChunk("a"), {
        type: "assistant",
        data: "not-json",
      }),
    ).toBeNull();
  });
});
