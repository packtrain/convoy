import { describe, expect, test } from "vitest";
import { claudeCodeChunkStreamPolicy } from "./streaming.js";
import type { ContentChunk } from "../contracts.js";

function textDeltaChunk(text: string, index = 0): ContentChunk {
  return {
    type: "stream_event",
    data: JSON.stringify({
      type: "stream_event",
      session_id: "s1",
      event: {
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text },
      },
    }),
  };
}

function thinkingDeltaChunk(thinking: string, index = 0): ContentChunk {
  return {
    type: "stream_event",
    data: JSON.stringify({
      type: "stream_event",
      session_id: "s1",
      event: {
        type: "content_block_delta",
        index,
        delta: { type: "thinking_delta", thinking },
      },
    }),
  };
}

describe("claudeCodeChunkStreamPolicy", () => {
  test("stream_event chunks are deferrable, whole messages are not", () => {
    expect(claudeCodeChunkStreamPolicy.isDeferrable(textDeltaChunk("x"))).toBe(true);
    expect(
      claudeCodeChunkStreamPolicy.isDeferrable({ type: "assistant", data: "{}" })
    ).toBe(false);
  });

  test("coalesces consecutive text deltas of the same block", () => {
    const merged = claudeCodeChunkStreamPolicy.coalesce(
      textDeltaChunk("Hel"),
      textDeltaChunk("lo")
    );

    expect(merged?.type).toBe("stream_event");
    const parsed = JSON.parse(merged!.data) as {
      event: { delta: { text: string } };
      session_id: string;
    };
    expect(parsed.event.delta.text).toBe("Hello");
    expect(parsed.session_id).toBe("s1");
  });

  test("coalesces consecutive thinking deltas of the same block", () => {
    const merged = claudeCodeChunkStreamPolicy.coalesce(
      thinkingDeltaChunk("Think"),
      thinkingDeltaChunk("ing")
    );

    const parsed = JSON.parse(merged!.data) as {
      event: { delta: { thinking: string } };
    };
    expect(parsed.event.delta.thinking).toBe("Thinking");
  });

  test("does not coalesce across different parent_tool_use_id or session_id", () => {
    const subagentDelta: ContentChunk = {
      type: "stream_event",
      data: JSON.stringify({
        type: "stream_event",
        session_id: "s1",
        parent_tool_use_id: "toolu_parent",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "child" },
        },
      }),
    };
    const otherSessionDelta: ContentChunk = {
      type: "stream_event",
      data: JSON.stringify({
        type: "stream_event",
        session_id: "s2",
        event: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "other" },
        },
      }),
    };

    expect(
      claudeCodeChunkStreamPolicy.coalesce(textDeltaChunk("main"), subagentDelta)
    ).toBeNull();
    expect(
      claudeCodeChunkStreamPolicy.coalesce(subagentDelta, textDeltaChunk("main"))
    ).toBeNull();
    expect(
      claudeCodeChunkStreamPolicy.coalesce(textDeltaChunk("a"), otherSessionDelta)
    ).toBeNull();
  });

  test("does not coalesce across block indices or delta types", () => {
    expect(
      claudeCodeChunkStreamPolicy.coalesce(
        textDeltaChunk("a", 0),
        textDeltaChunk("b", 1)
      )
    ).toBeNull();
    expect(
      claudeCodeChunkStreamPolicy.coalesce(
        thinkingDeltaChunk("a"),
        textDeltaChunk("b")
      )
    ).toBeNull();
  });

  test("does not coalesce lifecycle stream events or non-stream chunks", () => {
    const messageStop: ContentChunk = {
      type: "stream_event",
      data: JSON.stringify({
        type: "stream_event",
        event: { type: "message_stop" },
      }),
    };
    expect(
      claudeCodeChunkStreamPolicy.coalesce(messageStop, textDeltaChunk("a"))
    ).toBeNull();
    expect(
      claudeCodeChunkStreamPolicy.coalesce(
        { type: "assistant", data: "{}" },
        textDeltaChunk("a")
      )
    ).toBeNull();
  });
});
