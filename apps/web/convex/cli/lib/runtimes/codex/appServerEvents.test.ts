import { describe, expect, test } from "vitest";
import {
  isCodexAppServerChunk,
  isCodexAppServerEphemeralChunk,
  normalizeCodexAppServerChunk,
} from "./appServerEvents";
import {
  getCodexContinuationIdFromIncomingChunks,
  normalizeCodexChunk,
} from "./normalizeChunk";

function chunk(type: string, params: Record<string, unknown>) {
  return { type, data: JSON.stringify(params) };
}

describe("isCodexAppServerChunk", () => {
  test("slash-separated methods are app-server chunks, exec events are not", () => {
    expect(isCodexAppServerChunk({ type: "item/completed", data: "{}" })).toBe(true);
    expect(isCodexAppServerChunk({ type: "item.completed", data: "{}" })).toBe(false);
    expect(isCodexAppServerChunk({ type: "error", data: "{}" })).toBe(false);
  });
});

describe("normalizeCodexAppServerChunk", () => {
  test("normalizes structured quota without creating session or turn identity", () => {
    const usage = { account: "one@example.com", refreshedAt: 1234, buckets: [{
      id: "codex", windows: [{ name: "primary", usedPercent: 0 }],
    }] };
    const report = chunk("convoy.account_usage", usage);
    expect(normalizeCodexChunk(report)).toEqual({ kind: "account-usage", usage });
    expect(getCodexContinuationIdFromIncomingChunks([report])).toBeNull();
    expect(isCodexAppServerEphemeralChunk(report)).toBe(false);
  });

  test.each([
    { account: null }, { refreshedAt: -1 }, { refreshedAt: 9e15 }, { buckets: null },
    { buckets: [{ id: "codex", windows: [{ name: "primary", usedPercent: 101 }] }] },
    { buckets: [{ id: "codex", windows: [{ name: "primary", resetsAt: 9e12 }] }] },
    { buckets: [{ id: "codex", windows: [{ name: "primary", durationMinutes: 0 }] }] },
  ])("rejects malformed structured quota: %j", invalid => {
    expect(normalizeCodexChunk(chunk("convoy.account_usage", {
      account: "one@example.com", refreshedAt: 1234, buckets: [], ...invalid,
    }))).toMatchObject({ kind: "unknown", reason: "Invalid account usage snapshot" });
  });

  test("renders a local quota report without creating session or turn identity", () => {
    const report = chunk("item/completed", {
      item: { type: "agentMessage", id: "convoy-account-usage", text: "Codex account quota\n25% used, 75% remaining" },
    });
    expect(normalizeCodexChunk(report)).toMatchObject({ kind: "text", text: "Codex account quota\n25% used, 75% remaining" });
    expect(getCodexContinuationIdFromIncomingChunks([report])).toBeNull();
    expect(isCodexAppServerEphemeralChunk(report)).toBe(false);
  });

  test("keeps native proposed plans separate from checklist progress", () => {
    expect(normalizeCodexAppServerChunk(chunk("item/completed", {
      turnId: "turn-1", item: { type: "plan", id: "plan-1", text: "# Plan" },
    }))).toEqual({ kind: "proposed-plan", phase: "completed", itemId: "plan-1", turnId: "turn-1", text: "# Plan" });
  });

  test("streams plan text with its own identity", () => {
    const delta = chunk("item/plan/delta", { turnId: "turn-1", itemId: "plan-1", delta: "# Draft" });
    expect(normalizeCodexAppServerChunk(delta)).toEqual({ kind: "proposed-plan", phase: "delta", itemId: "plan-1", turnId: "turn-1", text: "# Draft" });
    expect(isCodexAppServerEphemeralChunk(delta)).toBe(true);
  });

  test.each(["started", "completed"])("maps sleep %s with identity and timing", (phase) => {
    expect(normalizeCodexAppServerChunk(chunk(`item/${phase}`, {
      item: { type: "sleep", id: "sleep-1", durationMs: 30_000 },
      threadId: "thread-1", turnId: "turn-1",
      startedAtMs: 1_000, completedAtMs: 31_000,
    }))).toEqual({
      kind: "sleep", phase, itemId: "sleep-1", sessionId: "thread-1", turnId: "turn-1",
      durationMs: 30_000,
      ...(phase === "started" ? { startedAt: 1_000 } : { completedAt: 31_000 }),
    });
  });

  test.each([-1, "30000", null, 1e100])("ignores invalid sleep timing %s", (value) => {
    expect(normalizeCodexAppServerChunk(chunk("item/started", {
      item: { type: "sleep", durationMs: value }, startedAtMs: value,
    }))).toEqual({ kind: "sleep", phase: "started" });
  });

  test("preserves a zero-duration sleep", () => {
    expect(normalizeCodexAppServerChunk(chunk("item/completed", {
      item: { type: "sleep", id: "sleep-2", durationMs: 0 },
    }))).toMatchObject({ kind: "sleep", phase: "completed", durationMs: 0 });
  });

  test("preserves turn identity on interruption", () => {
    const event = normalizeCodexAppServerChunk(chunk("turn/completed", {
      threadId: "thread-1", turn: { id: "turn-1", status: "interrupted" },
    }));
    expect(event.kind === "metadata" && JSON.parse(event.otherJson ?? "{}"))
      .toMatchObject({ event: "turn/completed", turnId: "turn-1", sessionId: "thread-1", status: "interrupted" });
  });
  test("thread/started carries the thread id as sessionId metadata", () => {
    expect(
      normalizeCodexAppServerChunk(chunk("thread/started", { thread: { id: "t-1" } }))
    ).toMatchObject({ kind: "metadata", sessionId: "t-1" });
  });

  test("turn/plan/updated maps explicit statuses to plan-progress", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("turn/plan/updated", {
          threadId: "t-1",
          turnId: "turn-1",
          explanation: "why",
          plan: [
            { step: "Alpha", status: "completed" },
            { step: "Beta", status: "inProgress" },
            { step: " ", status: "pending" },
            { step: "Gamma", status: "pending" },
          ],
        })
      )
    ).toEqual({
      kind: "plan-progress",
      steps: [
        { text: "Alpha", status: "completed" },
        { text: "Beta", status: "in-progress" },
        { text: "Gamma", status: "pending" },
      ],
    });
  });

  test("an empty turn/plan/updated is silent metadata, like the exec transport", () => {
    expect(
      normalizeCodexAppServerChunk(chunk("turn/plan/updated", { plan: [] })).kind
    ).toBe("metadata");
  });

  test("agentMessage completion becomes a text event; start is silent", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", { item: { type: "agentMessage", id: "m1", text: "done" } })
      )
    ).toEqual({ kind: "text", text: "done", source: { itemId: "m1" } });
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/started", { item: { type: "agentMessage", id: "m1", text: "" } })
      ).kind
    ).toBe("metadata");
  });

  test("reasoning completion joins content, falling back to summary", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", {
          item: { type: "reasoning", id: "r1", content: ["a", "b"], summary: [] },
        })
      )
    ).toEqual({ kind: "reasoning", text: "a\n\nb", source: { itemId: "r1" } });
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", {
          item: { type: "reasoning", id: "r1", content: [], summary: ["s"] },
        })
      )
    ).toEqual({ kind: "reasoning", text: "s", source: { itemId: "r1" } });
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", { item: { type: "reasoning", id: "r1", content: [], summary: [] } })
      )
    ).toEqual({ kind: "reasoning", text: "", source: { itemId: "r1" } });
  });

  test("commandExecution maps to Shell tool-input then tool-output", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/started", {
          item: { type: "commandExecution", id: "c1", command: "ls", status: "inProgress" },
        })
      )
    ).toEqual({
      kind: "tool-input",
      toolCallId: "c1",
      toolName: "Shell",
      inputJson: JSON.stringify({ command: "ls" }),
    });

    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", {
          item: {
            type: "commandExecution",
            id: "c1",
            command: "ls",
            status: "completed",
            exitCode: 0,
            aggregatedOutput: "file.txt",
          },
        })
      )
    ).toEqual({
      kind: "tool-output",
      toolCallId: "c1",
      outputJson: JSON.stringify({ output: "file.txt", exitCode: 0 }),
    });
  });

  test("imageView maps to a lightweight View image tool lifecycle", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/started", {
          item: {
            type: "imageView",
            id: "image-1",
            path: "/tmp/os-1303.png",
          },
        })
      )
    ).toEqual({
      kind: "tool-input",
      toolCallId: "image-1",
      toolName: "View image",
      inputJson: JSON.stringify({ path: "/tmp/os-1303.png" }),
    });

    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", {
          item: {
            type: "imageView",
            id: "image-1",
            path: "/tmp/os-1303.png",
          },
        })
      )
    ).toEqual({
      kind: "tool-output",
      toolCallId: "image-1",
      outputJson: JSON.stringify({ path: "/tmp/os-1303.png" }),
    });
  });

  test("imageView without a path still avoids the unknown-event fallback", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/started", {
          item: { type: "imageView", id: "image-2" },
        })
      )
    ).toEqual({
      kind: "tool-input",
      toolCallId: "image-2",
      toolName: "View image",
      inputJson: "{}",
    });
  });

  test("failed and declined commands become tool-errors", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", {
          item: { type: "commandExecution", id: "c1", status: "failed", exitCode: 1, aggregatedOutput: "boom" },
        })
      )
    ).toMatchObject({ kind: "tool-error", errorText: expect.stringContaining("boom") });

    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", {
          item: { type: "commandExecution", id: "c1", status: "declined" },
        })
      )
    ).toMatchObject({ kind: "tool-error", errorText: "Command was not approved." });
  });

  test("fileChange maps to Apply changes with declined support", () => {
    const changes = [{ path: "a.ts", kind: "update", diff: "+x" }];
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/started", { item: { type: "fileChange", id: "f1", changes, status: "inProgress" } })
      )
    ).toEqual({
      kind: "tool-input",
      toolCallId: "f1",
      toolName: "Apply changes",
      inputJson: JSON.stringify({ changes }),
    });
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", { item: { type: "fileChange", id: "f1", changes, status: "declined" } })
      )
    ).toMatchObject({ kind: "tool-error" });
  });

  test("userMessage echo items stay silent", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", {
          item: { type: "userMessage", id: "u1", content: [{ type: "text", text: "hi" }] },
        })
      ).kind
    ).toBe("metadata");
  });

  test("contextCompaction items map to context-compaction events (OS-1385)", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/started", { item: { type: "contextCompaction", id: "c1" } })
      )
    ).toMatchObject({
      kind: "context-compaction",
      message: "Compacting…",
      inProgress: true,
    });
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", { item: { type: "contextCompaction", id: "c1" } })
      )
    ).toMatchObject({
      kind: "context-compaction",
      message: "Conversation compacted",
    });
  });

  test("token usage becomes a context-window event from the last turn usage", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("thread/tokenUsage/updated", {
          tokenUsage: {
            total: { totalTokens: 109007 },
            last: { totalTokens: 16099, inputTokens: 16094, cachedInputTokens: 14720, outputTokens: 5 },
            modelContextWindow: 258400,
          },
        })
      )
    ).toEqual({
      kind: "context-window",
      usedTokens: 16099,
      maxTokens: 258400,
      inputTokens: 16094,
      cachedInputTokens: 14720,
      outputTokens: 5,
    });
  });

  test("token usage without a context window is silent metadata", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("thread/tokenUsage/updated", {
          tokenUsage: { last: { totalTokens: 10 }, modelContextWindow: null },
        })
      ).kind
    ).toBe("metadata");
  });

  test("deltas become text/reasoning deltas and are ephemeral", () => {
    expect(
      normalizeCodexAppServerChunk(chunk("item/agentMessage/delta", { delta: "do" }))
    ).toEqual({ kind: "text-delta", text: "do" });
    expect(
      normalizeCodexAppServerChunk(chunk("item/reasoning/summaryTextDelta", { delta: "th" }))
    ).toEqual({ kind: "reasoning-delta", text: "th" });

    expect(isCodexAppServerEphemeralChunk(chunk("item/agentMessage/delta", {}))).toBe(true);
    expect(isCodexAppServerEphemeralChunk(chunk("item/completed", {}))).toBe(false);
  });

  test("failed turns become runtime notices, completed turns stay silent", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("turn/completed", {
          turn: { id: "t", status: "failed", error: { message: "limit reached" } },
        })
      )
    ).toMatchObject({
      kind: "runtime-notice",
      code: "codex-turn-failed",
      message: "limit reached",
    });
    expect(
      normalizeCodexAppServerChunk(
        chunk("turn/completed", { turn: { id: "t", status: "completed", error: null } })
      ).kind
    ).toBe("metadata");
  });

  test("unrecognized methods fall back to unknown", () => {
    expect(
      normalizeCodexAppServerChunk(chunk("thread/settings/updated", {}))
    ).toMatchObject({ kind: "unknown" });
  });
});

describe("Codex goals (OS-2277)", () => {
  const goal = (status: string, overrides: Record<string, unknown> = {}) => ({
    threadId: "t-root", objective: "count.txt holds 3", status, tokenBudget: null, tokensUsed: 1200,
    timeUsedSeconds: 3, createdAt: 100, updatedAt: 101, ...overrides,
  });
  const snapshot = (action: string, value: Record<string, unknown> | null, extra: Record<string, unknown> = {}) =>
    normalizeCodexAppServerChunk(chunk("convoy/goal/snapshot", { action, threadId: "t-root", goal: value, ...extra }));
  const events = (event: ReturnType<typeof normalizeCodexAppServerChunk>) =>
    event.kind === "metadata" && event.otherJson ? JSON.parse(event.otherJson).events : [event];

  test("a set snapshot reports the goal and renders a Goal set notice", () => {
    expect(events(snapshot("set", goal("active")))).toEqual([
      { kind: "goal", source: "report", status: "active", objective: "count.txt holds 3", tokensUsed: 1200, sessionId: "t-root" },
      { kind: "runtime-notice", code: "goal-set", title: "Goal set", message: "count.txt holds 3", sessionId: "t-root" },
    ]);
  });

  test.each([
    ["auto-pause", goal("paused"), "goal-paused", "Goal paused", "count.txt holds 3. Convoy paused it before reopening the thread. Send /goal resume to continue."],
    ["pause", goal("paused"), "goal-paused", "Goal paused", "count.txt holds 3"],
    ["resume", goal("active"), "goal-resumed", "Goal resumed", "count.txt holds 3"],
    ["read", goal("budgetLimited", { tokenBudget: 5000 }), "goal-status", "Goal reached its token budget", "count.txt holds 3 (1.2k of 5k tokens)"],
    ["read", null, "goal-status", "Goal", "No goal set"],
    ["pause", null, "goal-status", "Goal", "No goal set"],
  ])("a %s snapshot renders its notice", (action, value, code, title, message) => {
    expect(events(snapshot(action, value)).at(-1)).toEqual({ kind: "runtime-notice", code, title, message, sessionId: "t-root" });
  });

  test("a clear snapshot removes the goal and names the cleared objective", () => {
    expect(events(snapshot("clear", null, { clearedObjective: "count.txt holds 3" }))).toEqual([
      { kind: "goal", source: "cleared", sessionId: "t-root" },
      { kind: "runtime-notice", code: "goal-cleared", title: "Goal cleared", message: "count.txt holds 3", sessionId: "t-root" },
    ]);
  });

  test.each([
    ["complete", "goal-met", "Goal met"],
    ["blocked", "goal-limited", "Goal blocked"],
    ["usageLimited", "goal-limited", "Goal stopped at a usage limit"],
    ["active", "goal-set", "Goal set"],
  ])("a native %s update renders %s", (status, code, title) => {
    const event = normalizeCodexAppServerChunk(chunk("thread/goal/updated", {
      threadId: "t-root", turnId: "turn-1", goal: goal(status), convoyRootThreadId: "t-root",
    }));
    expect(events(event)).toMatchObject([{ kind: "goal", source: "report", status }, { kind: "runtime-notice", code, title }]);
  });

  test("a child thread's goal update stays silent", () => {
    expect(normalizeCodexAppServerChunk(chunk("thread/goal/updated", {
      threadId: "child-a", turnId: "turn-1", goal: goal("complete", { threadId: "child-a" }), convoyRootThreadId: "t-root",
    }))).toMatchObject({ kind: "metadata" });
    expect(normalizeCodexAppServerChunk(chunk("thread/goal/cleared", { threadId: "child-a", convoyRootThreadId: "t-root" })))
      .toMatchObject({ kind: "metadata" });
  });

  test("a sync snapshot updates the goal without a notice (CR1 #2)", () => {
    expect(snapshot("sync", goal("paused"))).toEqual(
      { kind: "goal", source: "report", status: "paused", objective: "count.txt holds 3", tokensUsed: 1200, sessionId: "t-root" });
    expect(snapshot("sync", null)).toEqual({ kind: "goal", source: "cleared", sessionId: "t-root" });
  });

  test("a malformed goal stays unknown", () => {
    expect(snapshot("set", { objective: 3 })).toMatchObject({ kind: "unknown" });
  });
});

describe("codex dispatch across transports", () => {
  test("normalizeCodexChunk routes app-server chunks to the app-server normalizer", () => {
    expect(
      normalizeCodexChunk(
        chunk("item/completed", { item: { type: "agentMessage", id: "m1", text: "hi" } })
      )
    ).toEqual({ kind: "text", text: "hi", source: { itemId: "m1" } });
  });

  test("app-server error notifications keep the nested message", () => {
    expect(
      normalizeCodexChunk(
        chunk("error", { error: { message: "rate limited" }, willRetry: false })
      )
    ).toEqual({ kind: "warning", code: "codex-error", message: "rate limited" });
  });

  test("continuation extraction reads both transports", () => {
    expect(
      getCodexContinuationIdFromIncomingChunks([
        chunk("turn/started", {}),
        chunk("thread/started", { thread: { id: "t-app" } }),
      ])
    ).toBe("t-app");
    expect(
      getCodexContinuationIdFromIncomingChunks([
        { type: "thread.started", data: JSON.stringify({ type: "thread.started", thread_id: "t-exec" }) },
      ])
    ).toBe("t-exec");
  });
});

describe("subagents", () => {
  test("preserves narrative identity on deltas and completion", () => {
    for (const [type, item, kind] of [
      ["item/agentMessage/delta", undefined, "text-delta"],
      ["item/completed", { type: "agentMessage", id: "same", text: "answer" }, "text"],
    ] as const) {
      expect(
        normalizeCodexAppServerChunk(
          chunk(type, {
            threadId: "root",
            turnId: "turn",
            itemId: "same",
            delta: "answer",
            item,
          })
        )
      ).toMatchObject({
        kind,
        text: "answer",
        source: { threadId: "root", turnId: "turn", itemId: "same" },
      });
    }
  });
  test.each(["/root", "/"])("does not create a child for %s", (agentPath) => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", {
          threadId: "root",
          item: {
            type: "subAgentActivity",
            id: "activity",
            agentThreadId: "other",
            agentPath,
            kind: "interacted",
          },
        })
      ).kind
    ).toBe("metadata");
  });
  test("groups subagent activity by provider thread and keeps its path", () => {
    const result = normalizeCodexAppServerChunk(
      chunk("item/completed", {
        threadId: "root",
        item: {
          type: "subAgentActivity",
          id: "activity",
          agentThreadId: "child",
          agentPath: "/root/test",
          kind: "started",
        },
      })
    );
    expect(result).toMatchObject({ kind: "runtime-notice", code: "codex-subagent" });
    expect(result.kind === "runtime-notice" && JSON.parse(result.detailsJson!)).toMatchObject({
      subtype: "codex_subagent",
      payload: {
        task_id: "codex:child",
        description: "/root/test",
        status: "started",
        parentThreadId: "root",
      },
    });
  });
  test("renders collaboration calls and preserves results", () => {
    const item = {
      type: "collabAgentToolCall",
      id: "call",
      tool: "spawnAgent",
      status: "completed",
      senderThreadId: "root",
      receiverThreadIds: ["a", "b"],
      agentsStates: { a: { status: "completed", message: "result" } },
    };
    expect(normalizeCodexAppServerChunk(chunk("item/started", { item }))).toMatchObject({
      kind: "tool-input",
      toolCallId: "call",
      toolName: "Agent spawnAgent",
    });
    const result = normalizeCodexAppServerChunk(chunk("item/completed", { item }));
    expect(result).toMatchObject({ kind: "tool-output", toolCallId: "call" });
    expect(result.kind === "tool-output" && JSON.parse(result.outputJson)).toMatchObject(item);
  });
  test("keeps child usage, plans, errors and continuation away from root metadata", () => {
    for (const method of [
      "thread/tokenUsage/updated",
      "turn/plan/updated",
      "thread/started",
      "error",
    ]) {
      const result = normalizeCodexAppServerChunk(
        chunk("convoy/child", {
          method,
          source: { scope: "child", threadId: "child", rootThreadId: "root" },
          params: {
            thread: { id: "child" },
            error: { message: "child failed" },
            tokenUsage: { last: { totalTokens: 100 }, modelContextWindow: 1000 },
          },
        })
      );
      expect(["metadata", "runtime-notice"]).toContain(result.kind);
      expect(result).not.toHaveProperty("sessionId");
    }
  });
});

describe("child envelopes and empty reasoning", () => {
  test("child deltas are ephemeral but completed narratives are retained", () => {
    expect(
      isCodexAppServerEphemeralChunk(chunk("convoy/child", { method: "item/agentMessage/delta" }))
    ).toBe(true);
    expect(
      isCodexAppServerEphemeralChunk(chunk("convoy/child", { method: "item/completed" }))
    ).toBe(false);
  });

  test("an empty identified reasoning completion still replaces its draft", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", {
          threadId: "root",
          convoyRootThreadId: "root",
          turnId: "turn",
          item: { type: "reasoning", id: "reasoning", content: [], summary: [] },
        })
      )
    ).toMatchObject({
      kind: "reasoning",
      text: "",
      source: { itemId: "reasoning", scope: "root" },
    });
  });
});

describe("review regressions", () => {
  test("interrupted collaboration is an unsuccessful terminal result", () => {
    expect(
      normalizeCodexAppServerChunk(
        chunk("item/completed", {
          item: { type: "collabAgentToolCall", id: "wait", tool: "wait", status: "interrupted" },
        })
      )
    ).toMatchObject({ kind: "tool-error", toolCallId: "wait" });
  });

  test("silent child metadata does not duplicate raw payloads", () => {
    const result = normalizeCodexAppServerChunk(
      chunk("convoy/child", {
        method: "turn/plan/updated",
        source: { scope: "child", threadId: "child" },
        params: { plan: [{ step: "private child plan", status: "inProgress" }] },
      })
    );
    expect(result.kind).toBe("metadata");
    expect(JSON.stringify(result)).not.toContain("private child plan");
  });
});

describe("collaboration marker", () => {
  test.each(["item/started", "item/completed"])(
    "marks %s without relying on tool JSON in the composer",
    (type) => {
      expect(
        normalizeCodexAppServerChunk(
          chunk(type, {
            item: { type: "collabAgentToolCall", id: "wait", tool: "wait", status: "completed" },
          })
        )
      ).toMatchObject({ toolFamily: "codex-collaboration" });
    }
  );
});
