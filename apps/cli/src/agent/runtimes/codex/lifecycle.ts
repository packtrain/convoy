import { boundBackgroundTasks } from "../validators.js";
import { isRecord } from "../../sdk/adapters/adapter-interface.js";
import type { ContentChunk } from "../contracts.js";

type ChildIdentity = { threadId: string; parentThreadId?: string; agentPath?: string };
const nonEmptyString = (value: unknown): string | undefined => (typeof value === "string" && value.length > 0 ? value : undefined);

/** Child envelopes cannot reach root accounting or lifecycle consumers. */
export function createCodexChildRouter(
  rootId: () => string | undefined,
  emit: (chunk: ContentChunk) => void,
  onChild?: (method: string, params: Record<string, unknown>, source: ChildIdentity & { scope: "child" | "unknown"; rootThreadId?: string }) => void,
) {
  const children = new Map<string, ChildIdentity>();
  const pending = new Map<string, { method: string; params: Record<string, unknown> }>();

  function forward(method: string, params: Record<string, unknown>, identity: ChildIdentity, registered: boolean) {
    const source = { ...identity, scope: registered ? "child" as const : "unknown" as const, rootThreadId: rootId() };
    onChild?.(method, params, source);
    emit({
      type: "convoy/child",
      data: JSON.stringify({
        method,
        params,
        source,
      }),
    });
  }

  function register(identity: ChildIdentity, fromSpawn = false) {
    if (identity.threadId === rootId() || identity.agentPath === "/root" || identity.agentPath === "/") return;
    const previous = children.get(identity.threadId);
    const merged = {
      ...identity,
      ...previous,
      agentPath: previous?.agentPath ?? identity.agentPath,
      parentThreadId: fromSpawn
        ? (identity.parentThreadId ?? previous?.parentThreadId)
        : (previous?.parentThreadId ?? identity.parentThreadId),
    };
    children.set(identity.threadId, merged);
    if (!previous || JSON.stringify(previous) !== JSON.stringify(merged)) forward("thread/started", {}, merged, true);
    const early = pending.get(identity.threadId);
    if (early) {
      pending.delete(identity.threadId);
      forward(early.method, early.params, merged, true);
    }
  }

  return (method: string, params: Record<string, unknown>): boolean => {
    const thread = isRecord(params.thread) ? params.thread : undefined;
    const eventThreadId = nonEmptyString(params.threadId) ?? nonEmptyString(thread?.id);
    if (method === "thread/started") {
      const source = isRecord(thread?.source) ? thread.source : undefined;
      const subAgent = isRecord(source?.subAgent) ? source.subAgent : undefined;
      const spawn = isRecord(subAgent?.thread_spawn) ? subAgent.thread_spawn : undefined;
      if (eventThreadId && spawn)
        register(
          {
            threadId: eventThreadId,
            agentPath: nonEmptyString(spawn.agent_path),
            parentThreadId: nonEmptyString(spawn.parent_thread_id) ?? nonEmptyString(thread?.parentThreadId),
          },
          true
        );
      return true;
    }
    const item = isRecord(params.item) ? params.item : undefined;
    if ((method === "item/started" || method === "item/completed") && item) {
      if (item.type === "subAgentActivity" && nonEmptyString(item.agentThreadId)) {
        register({
          threadId: nonEmptyString(item.agentThreadId)!,
          agentPath: nonEmptyString(item.agentPath),
          parentThreadId: eventThreadId,
        });
      }
      if (item.type === "collabAgentToolCall" && Array.isArray(item.receiverThreadIds)) {
        for (const receiver of item.receiverThreadIds) {
          if (nonEmptyString(receiver))
            register({ threadId: nonEmptyString(receiver)!, parentThreadId: nonEmptyString(item.senderThreadId) ?? eventThreadId });
        }
      }
    }
    if (!eventThreadId || eventThreadId === rootId()) return false;
    const child = children.get(eventThreadId);
    // Keep the latest early lifecycle for late identity, with bounded memory.
    if (!child && (method === "turn/started" || method === "turn/completed" || method === "error")) {
      const previous = pending.get(eventThreadId);
      const previousTurn = isRecord(previous?.params.turn) ? previous.params.turn.id : previous?.params.turnId;
      const incomingTurn = isRecord(params.turn) ? params.turn.id : params.turnId;
      const lateStart =
        method === "turn/started" &&
        previousTurn === incomingTurn &&
        (previous?.method === "turn/completed" || previous?.method === "error");
      if (!lateStart) {
        if (pending.size >= 128) pending.delete(pending.keys().next().value!);
        pending.set(eventThreadId, { method, params });
      }
    }
    forward(method, params, child ?? { threadId: eventThreadId }, child !== undefined);
    return true;
  };
}

/** Fold Codex lifecycle edges into complete snapshots for the composer jobs pill. */
export function createCodexJobTracker(rootId: () => string | undefined, emit: (chunk: ContentChunk) => void) {
  const jobs = new Map<string, { task_id: string; task_type: string; description: string }>();
  const terminalTurns = new Set<string>();
  const inactiveAgents = new Set<string>();
  const activeTurns = new Map<string, string>();
  let last = JSON.stringify(boundBackgroundTasks({ tasks: [] }));
  const put = (id: string, type: string, description: string) => {
    jobs.set(id, { task_id: id, task_type: type, description });
  };
  // Turn-aware child evidence outranks unversioned activity/status reports.
  const applyAgentState = (id: string, running: boolean, description: string) => {
    if (id === rootId() || activeTurns.has(id) || inactiveAgents.has(id)) return;
    if (running) put(`agent:${id}`, "local_agent", description);
    else jobs.delete(`agent:${id}`);
  };
  const publish = () => {
    const tasks = Array.from(jobs.values());
    const bounded = boundBackgroundTasks({ session_id: rootId(), tasks })!;
    const next = JSON.stringify({ tasks: bounded.tasks, total_count: bounded.total_count });
    if (next === last) return;
    last = next;
    emit({ type: "convoy/background_tasks", data: JSON.stringify(bounded) });
  };
  return (method: string, params: Record<string, unknown>, source?: Record<string, unknown>) => {
    if (!["turn/started", "turn/completed", "error", "item/started", "item/completed"].includes(method)) return;
    if (source) {
      const id = nonEmptyString(source.threadId);
      if (source.scope !== "child" || !id || id === rootId()) return;
      const turn = isRecord(params.turn) ? params.turn : undefined;
      const turnId = nonEmptyString(turn?.id) ?? nonEmptyString(params.turnId);
      const key = JSON.stringify([id, turnId]);
      if (method === "turn/started" && !terminalTurns.has(key)) {
        inactiveAgents.delete(id);
        if (turnId) activeTurns.set(id, turnId);
        put(`agent:${id}`, "local_agent", nonEmptyString(source.agentPath) ?? "Codex agent");
      } else if (method === "turn/completed" || (method === "error" && params.willRetry !== true)) {
        terminalTurns.add(key);
        if (!turnId || !activeTurns.has(id) || activeTurns.get(id) === turnId) {
          jobs.delete(`agent:${id}`);
          inactiveAgents.add(id);
          activeTurns.delete(id);
        }
      }
      publish();
      return;
    }
    if (params.threadId && params.threadId !== rootId()) return;
    if (method === "turn/completed" || (method === "error" && params.willRetry !== true)) {
      jobs.clear();
    }
    const item = isRecord(params.item) ? params.item : undefined;
    if (item?.type === "subAgentActivity" && nonEmptyString(item.agentThreadId) &&
        item.agentThreadId !== rootId() && item.agentPath !== "/root" && item.agentPath !== "/") {
      const id = String(item.agentThreadId);
      if (item.kind === "started") applyAgentState(id, true, nonEmptyString(item.agentPath) ?? "Codex agent");
      if (item.kind === "completed" || item.kind === "interrupted") applyAgentState(id, false, "");
    }
    if (item?.type === "commandExecution" && nonEmptyString(item.id)) {
      const id = `command:${item.id}`;
      if (method === "item/started" && (item.status === undefined || item.status === "inProgress")) {
        put(id, "local_bash", nonEmptyString(item.command) ?? "Shell command");
      } else if (method === "item/completed") jobs.delete(id);
    }
    if (item?.type === "collabAgentToolCall" && isRecord(item.agentsStates)) {
      for (const [id, value] of Object.entries(item.agentsStates)) {
        if (id === rootId() || !isRecord(value)) continue;
        if (value.status === "running" || value.status === "pendingInit") {
          applyAgentState(id, true, nonEmptyString(item.prompt) ?? "Codex agent");
        } else if (["completed", "interrupted", "errored", "shutdown", "notFound"].includes(String(value.status))) {
          applyAgentState(id, false, "");
        }
      }
    }
    publish();
  };
}

/** Track known children until their current turns finish, including spawn-to-start gaps. */
export function createCodexChildDrain() {
  const seen = new Set<string>();
  const active = new Map<string, string | undefined>();
  const terminal = new Set<string>();
  return {
    hasActive: () => active.size > 0,
    observe(method: string, params: Record<string, unknown>, source: ChildIdentity & { scope: string }) {
      if (source.scope !== "child") return;
      const id = source.threadId;
      const turn = isRecord(params.turn) ? params.turn : undefined;
      const turnId = nonEmptyString(turn?.id) ?? nonEmptyString(params.turnId);
      const key = JSON.stringify([id, turnId]);
      if (method === "thread/started" && !seen.has(id)) active.set(id, undefined);
      seen.add(id);
      if (method === "turn/started" && !terminal.has(key)) active.set(id, turnId);
      if (method === "turn/completed" || (method === "error" && params.willRetry !== true)) {
        terminal.add(key);
        if (!turnId || !active.get(id) || active.get(id) === turnId) active.delete(id);
      }
    },
  };
}
