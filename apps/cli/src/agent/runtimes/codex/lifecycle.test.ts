import { describe, expect, it, vi } from "vitest";
import type { ContentChunk } from "../contracts.js";
import { createCodexChildDrain, createCodexChildRouter, createCodexJobTracker } from "./lifecycle.js";

function setup() {
  const chunks: ContentChunk[] = [];
  const route = createCodexChildRouter(
    () => "root",
    (chunk) => chunks.push(chunk)
  );
  return { route, chunks, events: () => chunks.map((chunk) => JSON.parse(chunk.data)) };
}

describe("Codex child routing", () => {
  it("consumes malformed thread-start notifications without forwarding them", () => {
    const { route, chunks } = setup();
    expect(route("thread/started", {})).toBe(true);
    expect(chunks).toEqual([]);
  });

  it("isolates early completion and replays it after explicit identity", () => {
    const { route, events } = setup();
    expect(route("turn/completed", { threadId: "child", turn: { id: "turn", status: "completed" } })).toBe(true);
    expect(events()[0].source.scope).toBe("unknown");
    route("item/completed", {
      threadId: "root",
      item: { type: "subAgentActivity", agentThreadId: "child", agentPath: "/root/child", kind: "started" },
    });
    expect(events().map((event) => [event.method, event.source.scope])).toEqual([
      ["turn/completed", "unknown"],
      ["thread/started", "child"],
      ["turn/completed", "child"],
    ]);
    expect(events()[2].params.turn.status).toBe("completed");
    expect(events()[2].source.parentThreadId).toBe("root");
  });

  it.each(["/root", "/"])("excludes the %s path on activity and spawn metadata", (agentPath) => {
    const { route, events } = setup();
    route("item/started", { threadId: "root", item: { type: "subAgentActivity", agentThreadId: "other", agentPath } });
    route("thread/started", { thread: { id: "other", source: { subAgent: { thread_spawn: { agent_path: agentPath } } } } });
    route("turn/started", { threadId: "other", turn: { id: "other-turn" } });
    expect(events()).toHaveLength(1);
    expect(events()[0].source.scope).toBe("unknown");
  });

  it("never registers the provider root id or a thread without spawn identity", () => {
    const { route, events } = setup();
    route("item/started", { threadId: "root", item: { type: "collabAgentToolCall", receiverThreadIds: ["root"] } });
    route("thread/started", { thread: { id: "other" } });
    expect(route("turn/completed", { threadId: "root", turn: { id: "root-turn" } })).toBe(false);
    expect(events()).toEqual([]);
  });

  it("tracks two children and a nested agent without confusing provider and tool ids", () => {
    const { route, events } = setup();
    route("item/started", { threadId: "root", item: { type: "collabAgentToolCall", id: "call", receiverThreadIds: ["a", "b"] } });
    route("thread/started", {
      thread: { id: "nested", source: { subAgent: { thread_spawn: { agent_path: "/root/a/nested", parent_thread_id: "a" } } } },
    });
    for (const threadId of ["a", "b", "nested"]) {
      route("item/completed", { threadId, turnId: "turn", item: { type: "agentMessage", id: "same", text: threadId } });
    }
    expect(
      events()
        .filter((event) => event.method === "item/completed")
        .map((event) => event.source)
    ).toMatchObject([
      { scope: "child", threadId: "a", parentThreadId: "root" },
      { scope: "child", threadId: "b", parentThreadId: "root" },
      { scope: "child", threadId: "nested", parentThreadId: "a", agentPath: "/root/a/nested" },
    ]);
  });

  it("does not emit duplicate registration notices", () => {
    const { route, events } = setup();
    for (let i = 0; i < 2; i++)
      route("thread/started", { thread: { id: "a", source: { subAgent: { thread_spawn: { parent_thread_id: "root" } } } } });
    expect(events()).toHaveLength(1);
  });

  it("retains early terminal state when a duplicate start arrives before identity", () => {
    const { route, events } = setup();
    route("turn/completed", { threadId: "a", turn: { id: "one", status: "completed" } });
    route("turn/started", { threadId: "a", turn: { id: "one" } });
    route("thread/started", { thread: { id: "a", source: { subAgent: { thread_spawn: { parent_thread_id: "root" } } } } });
    expect(
      events()
        .filter((event) => event.source.scope === "child")
        .at(-1).method
    ).toBe("turn/completed");
  });

  it("late spawn metadata corrects the parent of a nested agent", () => {
    const { route, events } = setup();
    route("item/started", { threadId: "root", item: { type: "subAgentActivity", agentThreadId: "nested", agentPath: "/root/a/nested" } });
    route("thread/started", {
      thread: { id: "nested", source: { subAgent: { thread_spawn: { parent_thread_id: "a", agent_path: "/root/a/nested" } } } },
    });
    route("item/completed", { threadId: "nested", item: { type: "agentMessage", id: "message", text: "nested answer" } });
    expect(events().at(-1).source.parentThreadId).toBe("a");
  });
});

describe("Codex live jobs", () => {
  it("tracks commands through completion and does not count duplicate starts", () => {
    const snapshots: ContentChunk[] = [];
    const update = createCodexJobTracker(() => "root", (chunk) => snapshots.push(chunk));
    const item = { id: "shell", type: "commandExecution", command: "sleep 45", status: "inProgress" };
    update("item/started", { threadId: "root", item });
    update("item/started", { threadId: "root", item });
    expect(snapshots).toHaveLength(1);
    expect(JSON.parse(snapshots[0].data).tasks).toEqual([{ task_id: "command:shell", task_type: "local_bash", description: "sleep 45" }]);
    update("item/completed", { threadId: "root", item: { ...item, status: "failed" } });
    expect(JSON.parse(snapshots.at(-1)!.data).tasks).toEqual([]);
  });

  it("tracks registered agents, ignores unknown children and root, and clears terminal states", () => {
    const snapshots: ContentChunk[] = [];
    const update = createCodexJobTracker(() => "root", (chunk) => snapshots.push(chunk));
    const child = (threadId: string, scope = "child") => ({ threadId, scope, agentPath: `/root/${threadId}` });
    update("turn/started", {}, child("unknown", "unknown"));
    update("turn/started", {}, child("root"));
    expect(snapshots).toEqual([]);
    update("turn/started", { turn: { id: "one" } }, child("a"));
    update("turn/started", { turn: { id: "two" } }, child("b"));
    expect(JSON.parse(snapshots.at(-1)!.data).tasks).toHaveLength(2);
    update("error", { willRetry: true }, child("a"));
    expect(JSON.parse(snapshots.at(-1)!.data).tasks).toHaveLength(2);
    update("error", { willRetry: false }, child("a"));
    update("turn/completed", { turn: { id: "two", status: "interrupted" } }, child("b"));
    expect(JSON.parse(snapshots.at(-1)!.data).tasks).toEqual([]);
  });

  it("does not resurrect agents from wait calls and clears all jobs when the root ends", () => {
    const snapshots: ContentChunk[] = [];
    const update = createCodexJobTracker(() => "root", (chunk) => snapshots.push(chunk));
    update("item/completed", { item: { type: "collabAgentToolCall", tool: "wait", receiverThreadIds: ["a"], agentsStates: { a: { status: "completed" } } } });
    expect(snapshots).toEqual([]);
    update("item/started", { item: { id: "shell", type: "commandExecution", command: "test" } });
    update("turn/completed", { threadId: "root" });
    expect(JSON.parse(snapshots.at(-1)!.data).tasks).toEqual([]);
  });
});

it("projects activity-only agents and does not count ordinary shell calls inside an agent twice", () => {
  const snapshots: ContentChunk[] = [];
  const update = createCodexJobTracker(() => "root", (chunk) => snapshots.push(chunk));
  update("item/completed", { item: { type: "subAgentActivity", agentThreadId: "a", agentPath: "/root/review", kind: "started" } });
  expect(snapshots).toHaveLength(1);
  expect(JSON.parse(snapshots[0].data).tasks[0].description).toBe("/root/review");
  update("item/started", { item: { type: "commandExecution", id: "nested", command: "test" } }, { scope: "child", threadId: "a" });
  expect(snapshots).toHaveLength(1);
  update("item/completed", { item: { type: "subAgentActivity", agentThreadId: "a", kind: "completed" } });
  expect(JSON.parse(snapshots.at(-1)!.data).tasks).toEqual([]);
});

it("keeps child turn evidence ahead of interrupted collaboration reports", () => {
  const snapshots: ContentChunk[] = [];
  const update = createCodexJobTracker(() => "root", (chunk) => snapshots.push(chunk));
  const source = { scope: "child", threadId: "a" };
  update("turn/started", { turn: { id: "one" } }, source);
  update("item/completed", { item: { type: "collabAgentToolCall", agentsStates: { a: { status: "interrupted" } } } });
  expect(JSON.parse(snapshots.at(-1)!.data).tasks).toHaveLength(1);
  update("turn/completed", { turn: { id: "one" } }, source);
  update("turn/started", { turn: { id: "one" } }, source);
  expect(JSON.parse(snapshots.at(-1)!.data).tasks).toEqual([]);
  update("turn/started", { turn: { id: "two" } }, source);
  update("turn/completed", { turn: { id: "one" } }, source);
  expect(JSON.parse(snapshots.at(-1)!.data).tasks).toHaveLength(1);
});

it("does not resurrect an early completed child when its identity arrives", () => {
  const snapshots: ContentChunk[] = [];
  const update = createCodexJobTracker(() => "root", (chunk) => snapshots.push(chunk));
  const route = createCodexChildRouter(() => "root", (chunk) => {
    const event = JSON.parse(chunk.data);
    update(event.method, event.params, event.source);
  });
  const receive = (method: string, params: Record<string, unknown>) => {
    if (!route(method, params)) update(method, params);
  };
  receive("turn/completed", { threadId: "a", turn: { id: "one", status: "completed" } });
  receive("item/completed", { threadId: "root", item: { type: "subAgentActivity", agentThreadId: "a", kind: "started" } });
  expect(snapshots).toEqual([]);
  receive("turn/started", { threadId: "a", turn: { id: "two" } });
  expect(JSON.parse(snapshots.at(-1)!.data).tasks).toHaveLength(1);
});

it("ignores a stale running collaboration response after an early completion", () => {
  const snapshots: ContentChunk[] = [];
  const update = createCodexJobTracker(() => "root", c => snapshots.push(c));
  const route = createCodexChildRouter(() => "root", c => {
    const e = JSON.parse(c.data); update(e.method, e.params, e.source);
  });
  route("turn/completed", { threadId: "a", turn: { id: "one", status: "completed" } });
  const params = { threadId: "root", item: { type: "collabAgentToolCall", receiverThreadIds: ["a"], agentsStates: { a: { status: "running" } } } };
  if (!route("item/completed", params)) update("item/completed", params);
  expect(snapshots).toEqual([]);
});

it.each(["activity", "collaboration"])("ignores delayed %s completion during a newer child turn", kind => {
  const snapshots: ContentChunk[] = [];
  const update = createCodexJobTracker(() => "root", c => snapshots.push(c));
  const source = { scope: "child", threadId: "a" };
  update("turn/started", { turn: { id: "one" } }, source);
  update("turn/completed", { turn: { id: "one" } }, source);
  update("turn/started", { turn: { id: "two" } }, source);
  update("item/completed", { item: kind === "activity"
    ? { type: "subAgentActivity", agentThreadId: "a", kind: "completed" }
    : { type: "collabAgentToolCall", agentsStates: { a: { status: "completed" } } } });
  expect(JSON.parse(snapshots.at(-1)!.data).tasks).toHaveLength(1);
});

it("forwards structured child identity to the lifecycle hook before serializing", () => {
  const hook = vi.fn();
  const order: string[] = [];
  const route = createCodexChildRouter(() => "root", () => order.push("chunk"), (...args) => { hook(...args); order.push("hook"); });
  route("thread/started", { thread: { id: "a", source: { subAgent: { thread_spawn: { parent_thread_id: "root" } } } } });
  expect(hook).toHaveBeenCalledWith("thread/started", {}, expect.objectContaining({ threadId: "a", scope: "child", rootThreadId: "root" }));
  expect(order).toEqual(["hook", "chunk"]);
});


describe("child drain", () => {
  it("waits through spawn, ignores stale completions, and does not reopen terminal turns", () => {
    const drain = createCodexChildDrain();
    const source = { threadId: "child", scope: "child" };
    drain.observe("thread/started", {}, source);
    expect(drain.hasActive()).toBe(true);
    drain.observe("turn/started", { turn: { id: "new" } }, source);
    drain.observe("turn/completed", { turn: { id: "old" } }, source);
    expect(drain.hasActive()).toBe(true);
    drain.observe("turn/completed", { turn: { id: "new" } }, source);
    drain.observe("thread/started", {}, source);
    drain.observe("turn/started", { turn: { id: "new" } }, source);
    expect(drain.hasActive()).toBe(false);
  });
  it("ignores unknown threads and drains failed children", () => {
    const drain = createCodexChildDrain();
    drain.observe("turn/started", {}, { threadId: "foreign", scope: "unknown" });
    expect(drain.hasActive()).toBe(false);
    const source = { threadId: "child", scope: "child" };
    drain.observe("thread/started", {}, source);
    drain.observe("error", { willRetry: true }, source);
    expect(drain.hasActive()).toBe(true);
    drain.observe("error", { willRetry: false }, source);
    expect(drain.hasActive()).toBe(false);
  });
});
