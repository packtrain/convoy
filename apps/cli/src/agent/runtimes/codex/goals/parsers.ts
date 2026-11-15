import { isRecord } from "../../../sdk/adapters/adapter-interface.js";
import type { CodexGoal, CodexGoalStatus, GoalCommand } from "./validators.js";

const MAX_OBJECTIVE_LENGTH = 4_000;
const STATUSES = new Set<CodexGoalStatus>(["active", "paused", "blocked", "usageLimited", "budgetLimited", "complete"]);

/** `/goal` arguments; a bare control word is reserved, anything else is the objective. */
export function parseGoalCommand(args: string | undefined): GoalCommand {
  const text = (args ?? "").trim();
  if (text === "") return { kind: "read" };
  if (text === "pause" || text === "resume" || text === "clear") return { kind: text };
  if (text.length > MAX_OBJECTIVE_LENGTH) {
    throw new Error("A goal objective can be at most 4,000 characters.");
  }
  return { kind: "set", objective: text };
}

/** A native `ThreadGoal`, or null when the value is not one. */
export function parseCodexGoal(value: unknown): CodexGoal | null {
  if (!isRecord(value) || typeof value.threadId !== "string" || typeof value.objective !== "string" ||
    !STATUSES.has(value.status as CodexGoalStatus)) {
    return null;
  }
  const number = (field: unknown) => (typeof field === "number" && Number.isFinite(field) ? field : 0);
  return {
    threadId: value.threadId,
    objective: value.objective,
    status: value.status as CodexGoalStatus,
    tokenBudget: typeof value.tokenBudget === "number" ? value.tokenBudget : null,
    tokensUsed: number(value.tokensUsed),
    timeUsedSeconds: number(value.timeUsedSeconds),
    createdAt: number(value.createdAt),
    updatedAt: number(value.updatedAt),
  };
}

/** The `goal` of a `thread/goal/get` or `thread/goal/set` response; throws when malformed. */
export function parseGoalResponse(value: unknown): CodexGoal | null {
  if (isRecord(value) && value.goal === null) return null;
  const goal = isRecord(value) ? parseCodexGoal(value.goal) : null;
  if (!goal) throw new Error("Codex sent a goal response Convoy cannot read.");
  return goal;
}

/** Codex 0.166.0 rejects an unknown method as an "unknown variant" invalid request. */
export function isUnsupportedGoalRpc(error: unknown): boolean {
  return error instanceof Error && /unknown variant `thread\/goal\/|method not found/i.test(error.message);
}
