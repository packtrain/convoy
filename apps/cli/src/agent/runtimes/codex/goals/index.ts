import type { ContentChunk } from "../../contracts.js";
import type { JsonRpc } from "../../json-rpc.js";
import { isUnsupportedGoalRpc, parseCodexGoal, parseGoalResponse } from "./parsers.js";
import type { CodexGoal, GoalCommand, GoalSnapshotAction } from "./validators.js";

/**
 * Native Codex goal state for one runner execution (OS-2277). RPC responses are the
 * source of truth. Spec: docs/specs/cli-thread-goal.md → Codex.
 */
export function createCodexGoals(rpc: JsonRpc, emit: (chunk: ContentChunk) => void) {
  let goal: CodexGoal | null = null;
  // `updatedAt` of the last RPC response; older notifications are stale (C4).
  let confirmedAt = 0;
  // Its echo notification lands before the awaited response is applied; the response wins.
  let inFlight = 0;
  const request = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    inFlight++;
    try {
      return await rpc.request(method, params);
    } finally {
      inFlight--;
    }
  };

  const snapshot = (threadId: string | undefined, action: GoalSnapshotAction, clearedObjective?: string) =>
    emit({ type: "convoy/goal/snapshot", data: JSON.stringify({ action, threadId, goal, clearedObjective }) });

  const accept = (next: CodexGoal | null) => {
    goal = next;
    confirmedAt = Math.max(confirmedAt, next?.updatedAt ?? 0);
  };

  const set = async (threadId: string, params: Record<string, unknown>) => {
    accept(parseGoalResponse(await request("thread/goal/set", { threadId, ...params })));
  };

  const runCommand = async (threadId: string, command: GoalCommand): Promise<void> => {
    switch (command.kind) {
      case "read":
        break;
      case "pause":
        if (goal) await set(threadId, { status: "paused", origin: "user" });
        break;
      case "clear": {
        const cleared = goal?.objective;
        if (goal) await request("thread/goal/clear", { threadId, origin: "user" });
        accept(null);
        snapshot(threadId, "clear", cleared);
        return;
      }
      case "set":
        await set(threadId, { objective: command.objective, status: "active", origin: "user" });
        break;
      case "resume":
        await set(threadId, { status: "active", origin: "user" });
        break;
    }
    snapshot(threadId, command.kind);
  };

  return {
    /**
     * Before `thread/resume`: an active goal would start a turn by itself (C6), so pause it.
     * "done" means the command needs no open thread.
     */
    async prepareOpen(threadId: string, command: GoalCommand | undefined): Promise<"open" | "done"> {
      try {
        accept(parseGoalResponse(await request("thread/goal/get", { threadId })));
      } catch (error) {
        // A Codex without goal RPCs has no goal to resume; any other failure must not skip the pause.
        if (command || !isUnsupportedGoalRpc(error)) throw error;
        return "open";
      }
      if (command?.kind === "set" || command?.kind === "resume") {
        // The goal is set after the thread is open and configured (afterOpen); until then nothing may start a turn.
        if (goal?.status === "active") await set(threadId, { status: "paused", origin: "automatic" });
        return "open";
      }
      if (command) {
        await runCommand(threadId, command);
        return "done";
      }
      if (goal?.status === "active") {
        await set(threadId, { status: "paused", origin: "automatic" });
        snapshot(threadId, "auto-pause");
      } else {
        // Repairs a stored goal whose last change never reached Convoy (lost Stop pause, missed notification).
        snapshot(threadId, "sync");
      }
      return "open";
    },

    /** A new thread or branch has no goal (F1–F3): answer every command but `set` as such. */
    answerWithoutGoal(command: GoalCommand): boolean {
      if (command.kind === "set") return false;
      snapshot(undefined, command.kind);
      return true;
    },

    /** Re-read the goal; true while it is active. */
    async refresh(threadId: string): Promise<boolean> {
      accept(parseGoalResponse(await request("thread/goal/get", { threadId })));
      snapshot(threadId, "sync");
      return goal?.status === "active";
    },

    /** Set or resume once the thread is open and its mode and effort are set. */
    async afterOpen(threadId: string, command: GoalCommand): Promise<void> {
      await runCommand(threadId, command);
    },

    /** Root `thread/goal/*` notification; true when it changed objective or status (C2). */
    observe(method: string, params: Record<string, unknown>): boolean {
      if (inFlight > 0) return false;
      if (method === "thread/goal/cleared") {
        const changed = goal !== null;
        goal = null;
        return changed;
      }
      const next = method === "thread/goal/updated" ? parseCodexGoal(params.goal) : null;
      if (!next || next.updatedAt < confirmedAt) return false;
      const changed = next.objective !== goal?.objective || next.status !== goal?.status;
      goal = next;
      return changed;
    },

    isActive(): boolean {
      return goal?.status === "active";
    },

    /** Pause the goal; true only when Codex confirmed it. */
    async pause(threadId: string, origin: "user" | "automatic"): Promise<boolean> {
      try {
        await set(threadId, { status: "paused", origin });
        return goal?.status === "paused";
      } catch {
        return false;
      }
    },
  };
}
