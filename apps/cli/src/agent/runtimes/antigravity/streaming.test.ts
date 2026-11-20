import { describe, expect, it } from "vitest";
import { antigravityChunkStreamPolicy as policy, compactToolUpdate, MAX_TOOL_STRING_CHARS } from "./streaming.js";

const delta = (sessionUpdate: string, text: string) => ({
  type: "session/update",
  data: JSON.stringify({ sessionId: "s-1", update: { sessionUpdate, content: { type: "text", text } } }),
});

describe("antigravityChunkStreamPolicy", () => {
  it("defers and merges message chunks of one kind only", () => {
    const merged = policy.coalesce(delta("agent_message_chunk", "Hel"), delta("agent_message_chunk", "lo"));
    expect(merged && policy.text(merged)).toBe("Hello");
    expect(policy.coalesce(delta("agent_message_chunk", "a"), delta("agent_thought_chunk", "b"))).toBeNull();
    expect(policy.isDeferrable({ type: "session/update", data: JSON.stringify({ update: { sessionUpdate: "tool_call" } }) })).toBe(false);
    expect(policy.text(policy.withText(delta("agent_thought_chunk", "x"), "y"))).toBe("y");
  });
});

describe("compactToolUpdate", () => {
  it("marks a clipped string so a partial file or command never reads as whole", () => {
    const content = "IMPORTANT HEADER\n" + "x".repeat(8_000);
    const compacted = compactToolUpdate({ sessionUpdate: "tool_call", rawInput: { Content: content, Path: "/w/a.txt" } });
    const kept = (compacted.rawInput as { Content: string; Path: string }).Content;
    expect(kept.startsWith("[17 characters omitted]\n")).toBe(true);
    expect(kept.endsWith("x".repeat(100))).toBe(true);
    expect(kept.length).toBeLessThanOrEqual(MAX_TOOL_STRING_CHARS + 40);
    expect((compacted.rawInput as { Path: string }).Path).toBe("/w/a.txt");
  });
});
