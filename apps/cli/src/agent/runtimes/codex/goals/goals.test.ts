import { describe, expect, it, vi } from "vitest";
import type { ContentChunk } from "../../contracts.js";
import type { AppServerRpc } from "../app-server-rpc.js";
import { createCodexGoals } from "./index.js";
import { parseGoalCommand } from "./parsers.js";

// Native shapes from codex-cli 0.166.0 (trace R1/R2, OS-2277 trace).
function goal(status: string, overrides: Record<string, unknown> = {}) {
  return { threadId: "t-1", objective: "count.txt holds 3", status, tokenBudget: null, tokensUsed: 10,
    timeUsedSeconds: 0, createdAt: 100, updatedAt: 100, ...overrides };
}

function fakeRpc(handler: (method: string, params: Record<string, unknown>) => unknown) {
  const request = vi.fn(async (method: string, params?: unknown) => handler(method, (params ?? {}) as Record<string, unknown>));
  return { rpc: { request, notify: vi.fn(), close: vi.fn() } as AppServerRpc, request };
}

function snapshots(chunks: ContentChunk[]) {
  return chunks.map((chunk) => ({ type: chunk.type, ...JSON.parse(chunk.data) }));
}

describe("parseGoalCommand", () => {
  it.each([
    [undefined, { kind: "read" }],
    ["", { kind: "read" }],
    ["pause", { kind: "pause" }],
    [" resume ", { kind: "resume" }],
    ["clear", { kind: "clear" }],
    ["count.txt holds 3", { kind: "set", objective: "count.txt holds 3" }],
    ["pause the build when tests fail", { kind: "set", objective: "pause the build when tests fail" }],
  ])("parses %j", (input, expected) => {
    expect(parseGoalCommand(input)).toEqual(expected);
  });

  it("rejects an objective over 4,000 characters", () => {
    expect(() => parseGoalCommand("x".repeat(4001))).toThrow(/4,000/);
    expect(parseGoalCommand("x".repeat(4000))).toMatchObject({ kind: "set" });
  });
});

describe("createCodexGoals", () => {
  it("pauses an active goal before a plain run reopens the thread (C6, R1)", async () => {
    const { rpc, request } = fakeRpc((method, params) =>
      method === "thread/goal/get" ? { goal: goal("active") } : { goal: goal(String(params.status), { updatedAt: 101 }) });
    const chunks: ContentChunk[] = [];
    const goals = createCodexGoals(rpc, (chunk) => chunks.push(chunk));

    expect(await goals.prepareOpen("t-1", undefined)).toBe("open");

    expect(request.mock.calls).toEqual([
      ["thread/goal/get", { threadId: "t-1" }],
      ["thread/goal/set", { threadId: "t-1", status: "paused", origin: "automatic" }],
    ]);
    expect(snapshots(chunks)).toEqual([
      { type: "convoy/goal/snapshot", action: "auto-pause", threadId: "t-1", goal: goal("paused", { updatedAt: 101 }) },
    ]);
    expect(goals.isActive()).toBe(false);
  });

  it("leaves a paused or absent goal alone and syncs the stored goal to it (CR1 #2)", async () => {
    for (const current of [goal("paused"), null]) {
      const { rpc, request } = fakeRpc(() => ({ goal: current }));
      const chunks: ContentChunk[] = [];
      expect(await createCodexGoals(rpc, (chunk) => chunks.push(chunk)).prepareOpen("t-1", undefined)).toBe("open");
      expect(request).toHaveBeenCalledTimes(1);
      expect(snapshots(chunks)).toEqual([{ type: "convoy/goal/snapshot", action: "sync", threadId: "t-1", goal: current }]);
    }
  });

  it("falls back only when this Codex has no goal RPCs (CR1 #1)", async () => {
    const unsupported = fakeRpc(() => { throw new Error("thread/goal/get: Invalid request: unknown variant `thread/goal/get`, expected one of …"); });
    expect(await createCodexGoals(unsupported.rpc, () => {}).prepareOpen("t-1", undefined)).toBe("open");

    const transient = fakeRpc(() => { throw new Error("thread/goal/get: database temporarily unavailable"); });
    await expect(createCodexGoals(transient.rpc, () => {}).prepareOpen("t-1", undefined)).rejects.toThrow("database");
  });

  it("rejects a malformed goal response instead of reading it as no goal (CR1 #1)", async () => {
    const { rpc } = fakeRpc(() => ({ goal: { objective: 3 } }));
    await expect(createCodexGoals(rpc, () => {}).prepareOpen("t-1", undefined)).rejects.toThrow(/goal response/);
  });

  it("syncs the stored goal from a watchdog re-read (CR1 #2)", async () => {
    const { rpc } = fakeRpc(() => ({ goal: goal("complete") }));
    const chunks: ContentChunk[] = [];
    expect(await createCodexGoals(rpc, (chunk) => chunks.push(chunk)).refresh("t-1")).toBe(false);
    expect(snapshots(chunks)).toEqual([{ type: "convoy/goal/snapshot", action: "sync", threadId: "t-1", goal: goal("complete") }]);
  });

  it.each([
    [{ kind: "read" } as const, [], "read"],
    [{ kind: "pause" } as const, [["thread/goal/set", { threadId: "t-1", status: "paused", origin: "user" }]], "pause"],
    [{ kind: "clear" } as const, [["thread/goal/clear", { threadId: "t-1", origin: "user" }]], "clear"],
  ])("answers %j by RPC only, without opening the thread (R1, R2)", async (command, calls, action) => {
    const { rpc, request } = fakeRpc((method, params) =>
      method === "thread/goal/clear" ? { cleared: true }
      : method === "thread/goal/set" ? { goal: goal(String(params.status)) } : { goal: goal("active") });
    const chunks: ContentChunk[] = [];
    expect(await createCodexGoals(rpc, (chunk) => chunks.push(chunk)).prepareOpen("t-1", command)).toBe("done");
    expect(request.mock.calls).toEqual([["thread/goal/get", { threadId: "t-1" }], ...calls]);
    expect(snapshots(chunks)).toEqual([{
      type: "convoy/goal/snapshot", action, threadId: "t-1",
      goal: action === "clear" ? null : goal(action === "pause" ? "paused" : "active"),
      ...(action === "clear" ? { clearedObjective: "count.txt holds 3" } : {}),
    }]);
  });

  it.each([
    [{ kind: "set", objective: "new goal" } as const, { objective: "new goal", status: "active" }, "set"],
    [{ kind: "resume" } as const, { status: "active" }, "resume"],
  ])("defers %j until the thread is open and configured (CR2 #1)", async (command, params, action) => {
    for (const current of ["paused", "active"]) {
      const { rpc, request } = fakeRpc((method, rpcParams) =>
        method === "thread/goal/get" ? { goal: goal(current) } : { goal: goal(String(rpcParams.status)) });
      const chunks: ContentChunk[] = [];
      const goals = createCodexGoals(rpc, (chunk) => chunks.push(chunk));

      expect(await goals.prepareOpen("t-1", command)).toBe("open");
      // An active goal is paused first so thread/resume starts no turn before the mode is set (C6).
      expect(request.mock.calls.slice(1)).toEqual(current === "active"
        ? [["thread/goal/set", { threadId: "t-1", status: "paused", origin: "automatic" }]] : []);
      expect(chunks).toEqual([]);

      await goals.afterOpen("t-1", command);
      expect(request.mock.calls.at(-1)).toEqual(["thread/goal/set", { threadId: "t-1", ...params, origin: "user" }]);
      expect(snapshots(chunks)).toMatchObject([{ action, goal: { status: "active" } }]);
      expect(goals.isActive()).toBe(true);
    }
  });

  it("forwards a notification only when objective or status changes (C2)", async () => {
    const { rpc } = fakeRpc(() => ({ goal: goal("active") }));
    const goals = createCodexGoals(rpc, () => {});
    await goals.afterOpen("t-1", { kind: "set", objective: "count.txt holds 3" });

    expect(goals.observe("thread/goal/updated", { threadId: "t-1", turnId: "turn-1", goal: goal("active", { tokensUsed: 900, updatedAt: 105 }) })).toBe(false);
    expect(goals.observe("thread/goal/updated", { threadId: "t-1", turnId: "turn-1", goal: goal("budgetLimited", { updatedAt: 106 }) })).toBe(true);
    expect(goals.isActive()).toBe(false);
    expect(goals.observe("thread/goal/cleared", { threadId: "t-1" })).toBe(true);
    expect(goals.observe("thread/goal/cleared", { threadId: "t-1" })).toBe(false);
  });

  it("ignores a notification older than the last RPC response (C4)", async () => {
    const { rpc } = fakeRpc(() => ({ goal: goal("paused", { updatedAt: 200 }) }));
    const goals = createCodexGoals(rpc, () => {});
    await goals.pause("t-1", "user");
    expect(goals.observe("thread/goal/updated", { threadId: "t-1", turnId: null, goal: goal("active", { updatedAt: 199 }) })).toBe(false);
    expect(goals.isActive()).toBe(false);
  });

  it("drops the echo notification that arrives before the RPC response is applied", async () => {
    let observed: boolean | undefined;
    const goals = createCodexGoals(fakeRpc(() => {
      observed = goals.observe("thread/goal/updated", { threadId: "t-1", turnId: null, goal: goal("paused", { updatedAt: 101 }) });
      return { goal: goal("paused", { updatedAt: 101 }) };
    }).rpc, () => {});
    goals.observe("thread/goal/updated", { threadId: "t-1", turnId: "turn-1", goal: goal("active") });
    await goals.pause("t-1", "user");
    expect(observed).toBe(false);
  });

  it("tracks a goal the model creates on an ordinary run (C8)", () => {
    const goals = createCodexGoals(fakeRpc(() => ({})).rpc, () => {});
    expect(goals.observe("thread/goal/updated", { threadId: "t-1", turnId: "turn-1", goal: goal("active") })).toBe(true);
    expect(goals.isActive()).toBe(true);
  });

  it("confirms a Stop pause only from the RPC response", async () => {
    const goals = createCodexGoals(fakeRpc(() => { throw new Error("app-server exited"); }).rpc, () => {});
    goals.observe("thread/goal/updated", { threadId: "t-1", turnId: "turn-1", goal: goal("active") });
    expect(await goals.pause("t-1", "user")).toBe(false);
    expect(goals.isActive()).toBe(true);
  });
});
