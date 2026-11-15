import { describe, expect, test, vi } from "vitest";
import { api } from "../../../_generated/api";
import { createTestContext } from "../../../../convex-testing";
import {
  AGENT_TEXT_CHARS,
  AGENT_TEXT_CHUNK_SCAN,
  agentTextChunkScan,
  composeAgentMessageText,
  composeAgentMessageTexts,
  chunkAgentText,
} from "./agentText";

/**
 * A chunk the Claude Code normalizer resolves to a `text` event — the shape a
 * real assistant text row has on disk.
 */
function assistantText(text: string) {
  return {
    type: "assistant",
    data: JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text }] },
    }),
  };
}

function assistantReasoning(text: string) {
  return {
    type: "assistant",
    data: JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: [{ type: "thinking", thinking: text }] },
    }),
  };
}

function assistantToolUse(name: string) {
  return {
    type: "assistant",
    data: JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id: "tool-1", name, input: { path: "/repo" } }],
      },
    }),
  };
}

function toolResult(text: string) {
  return {
    type: "user",
    data: JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: text }],
      },
    }),
  };
}

describe("composeAgentMessageText (OS-1627)", () => {
  test("completed proposed plans are external agent text; drafts and ephemeral rows are not", () => {
    const normalizedEvent = {
      kind: "proposed-plan" as const, phase: "completed" as const,
      itemId: "plan-1", turnId: "turn-1", text: "  # Implementation plan  ",
    };
    expect(chunkAgentText({ normalizedEvent })).toBe("# Implementation plan");
    expect(chunkAgentText({ normalizedEvent, ephemeral: true })).toBeNull();
    expect(chunkAgentText({ normalizedEvent: { ...normalizedEvent, phase: "delta" } })).toBeNull();
    expect(chunkAgentText({ normalizedEvent: { ...normalizedEvent, text: " " } })).toBeNull();
  });
  test("goal notices read as their title and message (OS-2276)", () => {
    const normalizedEvent = {
      kind: "runtime-notice" as const, code: "goal-set", title: "Goal set", message: "a.txt exists",
    };
    expect(chunkAgentText({ normalizedEvent })).toBe("Goal set: a.txt exists");
    expect(chunkAgentText({ normalizedEvent: { ...normalizedEvent, code: "claude-api-retry" } })).toBeNull();
  });
  async function setup() {
    const ctx = createTestContext();
    const { user, project } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);
    const message = await ctx.cliMessage(thread._id, profile._id, { role: "assistant", content: [] });
    return { ctx, profile, thread, message };
  }

  test("excludes normalized child identity without extra database lookups", async () => {
    const { ctx, profile, thread, message } = await setup();
    await ctx.cliMessageChunks(message._id, thread._id, profile._id, [assistantText("Root answer")]);
    await ctx.t.run(async (runCtx) => {
      await runCtx.db.insert("cliMessageChunks", {
        messageId: message._id, threadId: thread._id, profileId: profile._id,
        chunkOrder: 1, createdAt: Date.now(), timestamp: Date.now(), type: "assistant",
        data: JSON.stringify({ parent_tool_use_id: "child-task", message: { content: [{ type: "text", text: "Child answer" }] } }),
        normalizedEvent: { kind: "text", text: "Child answer", source: { scope: "child", parentToolUseId: "child-task" } },
      });
    });
    const result = await ctx.t.run(async (runCtx) => {
      const get = vi.spyOn(runCtx.db, "get");
      try {
        const result = await composeAgentMessageText(runCtx, message, AGENT_TEXT_CHUNK_SCAN);
        expect(get).not.toHaveBeenCalled();
        return result;
      } finally { get.mockRestore(); }
    });
    expect(result.text).toBe("Root answer");
  });

  test("batch transcripts need no thread lookups", async () => {
    const { ctx, profile, thread, message } = await setup();
    await ctx.cliMessageChunks(message._id, thread._id, profile._id, [assistantText("Root answer")]);
    await ctx.t.run(async (runCtx) => {
      const storedMessage = await runCtx.db.get("cliMessages", message._id);
      if (!storedMessage) throw new Error("Missing fixture message");
      const get = vi.spyOn(runCtx.db, "get");
      try {
        const texts = await composeAgentMessageTexts(runCtx, [storedMessage], AGENT_TEXT_CHUNK_SCAN);
        expect(texts.get(message._id)?.text).toBe("Root answer");
        expect(get).not.toHaveBeenCalled();
      } finally { get.mockRestore(); }
    });
  });

  test("joins the message's text events in conversation order", async () => {
    const { ctx, profile, thread, message } = await setup();
    await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
      assistantText("First"),
      assistantText("Second"),
    ]);

    const composed = await ctx.t.run((runCtx) =>
      composeAgentMessageText(runCtx, message, AGENT_TEXT_CHUNK_SCAN)
    );

    // Oldest first, even though the scan reads the tail: an agent is given text
    // to read, and a reversed transcript means something different.
    expect(composed).toEqual({ text: "First\n\nSecond", truncated: false });
  });

  test("skips tool calls, tool output, and reasoning", async () => {
    const { ctx, profile, thread, message } = await setup();
    await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
      assistantReasoning("Considering the options"),
      assistantToolUse("Read"),
      toolResult("file contents"),
      assistantText("Here is the answer"),
    ]);

    const composed = await ctx.t.run((runCtx) =>
      composeAgentMessageText(runCtx, message, AGENT_TEXT_CHUNK_SCAN)
    );

    // v1 renders text only. A faithful tool/reasoning rendering is a different
    // feature, and these rows are the bulk of a run.
    expect(composed.text).toBe("Here is the answer");
  });

  test("composes nothing rather than failing when the window is all tool traffic", async () => {
    const { ctx, profile, thread, message } = await setup();
    await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
      assistantToolUse("Bash"),
      toolResult("done"),
    ]);

    const composed = await ctx.t.run((runCtx) =>
      composeAgentMessageText(runCtx, message, AGENT_TEXT_CHUNK_SCAN)
    );

    expect(composed).toEqual({ text: "", truncated: false });
  });

  test("keeps the newest text when the chunk scan cuts the window", async () => {
    const { ctx, profile, thread, message } = await setup();
    await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
      assistantText("Oldest"),
      assistantText("Middle"),
      assistantText("Newest"),
    ]);

    const composed = await ctx.t.run((runCtx) => composeAgentMessageText(runCtx, message, 2));

    // The tail is what a reader wants from an overflowing run: how it ended.
    expect(composed).toEqual({ text: "Middle\n\nNewest", truncated: true });
  });

  test("respects the char cap independently of the chunk scan", async () => {
    const { ctx, profile, thread, message } = await setup();
    await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
      assistantText("a".repeat(AGENT_TEXT_CHARS + 500)),
    ]);

    const composed = await ctx.t.run((runCtx) =>
      composeAgentMessageText(runCtx, message, AGENT_TEXT_CHUNK_SCAN)
    );

    // One chunk, well inside the scan cap, still truncated: the two caps bound
    // different things (rows read vs. chars emitted).
    expect(composed.text).toHaveLength(AGENT_TEXT_CHARS);
    expect(composed.truncated).toBe(true);
  });

  test("cuts before a surrogate pair rather than through it", async () => {
    const { ctx, profile, thread, message } = await setup();
    // The emoji straddles the cap: its high half is the last unit that fits.
    await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
      assistantText(`${"a".repeat(AGENT_TEXT_CHARS - 1)}\u{1F600}tail`),
    ]);

    const composed = await ctx.t.run((runCtx) =>
      composeAgentMessageText(runCtx, message, AGENT_TEXT_CHUNK_SCAN)
    );

    // One char short of the cap: a lone surrogate is not valid Unicode.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(composed.text)).toBe(false);
    expect(composed.text).toHaveLength(AGENT_TEXT_CHARS - 1);
    expect(composed.truncated).toBe(true);
  });

  test("sets truncated only when something was cut", async () => {
    const { ctx, profile, thread, message } = await setup();
    await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
      assistantText("Exactly two"),
      assistantText("chunks here"),
    ]);

    // Scan cap equal to the row count — the boundary case. Nothing was dropped,
    // so the flag must stay off: a `truncated: true` on a complete message would
    // make the flag meaningless to check.
    const composed = await ctx.t.run((runCtx) => composeAgentMessageText(runCtx, message, 2));

    expect(composed).toEqual({ text: "Exactly two\n\nchunks here", truncated: false });
  });

  test("ignores ephemeral partial-streaming rows", async () => {
    const { ctx, profile, thread, message } = await setup();
    const chunks = await ctx.cliMessageChunks(message._id, thread._id, profile._id, [
      assistantText("Whole message"),
    ]);
    await ctx.t.run(async (runCtx) => {
      await runCtx.db.patch("cliMessageChunks", chunks[0]._id, { ephemeral: true });
    });

    const composed = await ctx.t.run((runCtx) =>
      composeAgentMessageText(runCtx, message, AGENT_TEXT_CHUNK_SCAN)
    );

    // A delta is superseded by the whole `text` event it built up to; counting
    // both would double every sentence of a live run.
    expect(composed.text).toBe("");
  });

  test("composes a user message's text through the same path", async () => {
    const ctx = createTestContext();
    const { user, project, asUser, t } = await ctx.setupProject();
    const profile = await ctx.cliProfile(user._id, project._id);
    const thread = await ctx.cliThread(user._id, project._id, profile._id);

    // The real send path, so the assertion is about how a user message is
    // actually stored (one `text` chunk) rather than about a fixture.
    const messageId = await asUser.mutation(api.cli.messages.send, {
      threadId: thread._id,
      content: "Please review the diff",
    });

    const composed = await t.run((runCtx) =>
      composeAgentMessageText(runCtx, { _id: messageId, threadId: thread._id }, AGENT_TEXT_CHUNK_SCAN)
    );

    expect(composed).toEqual({ text: "Please review the diff", truncated: false });
  });
});

describe("agentTextChunkScan (OS-1627)", () => {
  test("derives the per-message cap from the request's page size", () => {
    // The default page reads the flat cap; the maximum page is tightened so the
    // request as a whole stays inside the same budget the thread window works to.
    expect(agentTextChunkScan(10)).toBe(AGENT_TEXT_CHUNK_SCAN);
    expect(agentTextChunkScan(20)).toBe(20);
    expect(agentTextChunkScan(1)).toBe(AGENT_TEXT_CHUNK_SCAN);
  });

  test("never derives a cap below one chunk", () => {
    // Defensive: the query clamps `limit` to 20, but a caller inside the domain
    // could pass more, and a cap of 0 would silently blank every message.
    expect(agentTextChunkScan(1000)).toBe(1);
  });
});

test("child narratives are not the parent transcript", () => {
  for (const source of [{ scope: "child" as const }, { scope: "unknown" as const }, { parentToolUseId: "task" }]) {
    expect(chunkAgentText({ normalizedEvent: { kind: "text", text: "child answer", source } })).toBeNull();
  }
});
