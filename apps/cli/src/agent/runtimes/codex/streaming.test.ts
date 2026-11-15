import { describe, expect, it } from "vitest";
import { codexChunkStreamPolicy } from "./streaming.js";

function delta(type: string, itemId: string, text: string) {
  return {
    type,
    data: JSON.stringify({ turnId: "turn-1", itemId, delta: text }),
  };
}

describe("codexChunkStreamPolicy", () => {
  it("defers delta notifications only", () => {
    expect(codexChunkStreamPolicy.isDeferrable(delta("item/plan/delta", "plan-1", "# Plan"))).toBe(true);
    expect(
      codexChunkStreamPolicy.isDeferrable({
        type: "item/agentMessage/delta",
        data: "{}",
      }),
    ).toBe(true);
    expect(
      codexChunkStreamPolicy.isDeferrable({
        type: "item/reasoning/textDelta",
        data: "{}",
      }),
    ).toBe(true);
    expect(
      codexChunkStreamPolicy.isDeferrable({
        type: "item/reasoning/summaryTextDelta",
        data: "{}",
      }),
    ).toBe(true);
    expect(
      codexChunkStreamPolicy.isDeferrable({ type: "item/completed", data: "{}" }),
    ).toBe(false);
  });

  it("coalesces consecutive deltas for the same item", () => {
    const merged = codexChunkStreamPolicy.coalesce(
      delta("item/agentMessage/delta", "msg-1", "Hel"),
      delta("item/agentMessage/delta", "msg-1", "lo"),
    );
    expect(merged?.type).toBe("item/agentMessage/delta");
    const parsed = JSON.parse(merged?.data ?? "{}");
    expect(parsed.delta).toBe("Hello");
    expect(parsed.itemId).toBe("msg-1");
    expect(parsed.turnId).toBe("turn-1");
  });

  it("refuses to merge across items, types, or malformed payloads", () => {
    expect(
      codexChunkStreamPolicy.coalesce(
        delta("item/agentMessage/delta", "msg-1", "a"),
        delta("item/agentMessage/delta", "msg-2", "b"),
      ),
    ).toBeNull();
    expect(
      codexChunkStreamPolicy.coalesce(
        delta("item/agentMessage/delta", "msg-1", "a"),
        delta("item/reasoning/textDelta", "msg-1", "b"),
      ),
    ).toBeNull();
    expect(
      codexChunkStreamPolicy.coalesce(
        delta("item/agentMessage/delta", "msg-1", "a"),
        { type: "item/agentMessage/delta", data: "not-json" },
      ),
    ).toBeNull();
  });
});

describe("Codex source-aware delta coalescing", () => {
  it.each([{ threadId: "other" }, { turnId: "other" }])(
    "keeps delta sources separate: %j",
    (identity) => {
      const first = {
        type: "item/agentMessage/delta",
        data: JSON.stringify({ threadId: "root", turnId: "turn", itemId: "same", delta: "a" }),
      };
      const second = {
        ...first,
        data: JSON.stringify({ ...JSON.parse(first.data), ...identity, delta: "b" }),
      };
      expect(codexChunkStreamPolicy.coalesce(first, second)).toBeNull();
    }
  );

  it("coalesces child deltas without merging different child sources", () => {
    const child = (threadId: string, delta: string) => ({
      type: "convoy/child",
      data: JSON.stringify({
        method: "item/agentMessage/delta",
        source: { scope: "child", threadId },
        params: { threadId, turnId: "turn", itemId: "same", delta },
      }),
    });
    expect(codexChunkStreamPolicy.isDeferrable(child("a", "a"))).toBe(true);
    const merged = codexChunkStreamPolicy.coalesce(child("a", "a"), child("a", "b"));
    expect(JSON.parse(merged?.data ?? "{}").params?.delta).toBe("ab");
    expect(codexChunkStreamPolicy.coalesce(child("a", "a"), child("b", "b"))).toBeNull();
  });
});
