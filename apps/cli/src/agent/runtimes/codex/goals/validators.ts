/** Native goal status in codex-cli 0.166.0 (`ThreadGoalStatus`). */
export type CodexGoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";

/** Native `ThreadGoal`, kept whole so the snapshot chunk carries what Codex reported. */
export interface CodexGoal {
  threadId: string;
  objective: string;
  status: CodexGoalStatus;
  tokenBudget: number | null;
  tokensUsed: number;
  timeUsedSeconds: number;
  createdAt: number;
  updatedAt: number;
}

/** A parsed `/goal [objective | pause | resume | clear]` command. */
export type GoalCommand =
  | { kind: "read" }
  | { kind: "set"; objective: string }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "clear" };

/** Why a `convoy/goal/snapshot` chunk was emitted; the web picks the notice from it. */
export type GoalSnapshotAction = GoalCommand["kind"] | "auto-pause" | "sync";
