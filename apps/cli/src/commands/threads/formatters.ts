import chalk from "chalk";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../convex/_generated/api.js";

export type ThreadSummary = FunctionReturnType<typeof api.cli.threads.summaries.getSummary>;
export type ThreadRow = NonNullable<ThreadSummary>;

/**
 * One row per unit of work: a group prints its child count and raw
 * `aggregateStatus`, an ordinary thread its status and runtime target.
 * `kind` is the discriminator — see `docs/specs/mcp-server.md`.
 */
export function formatThreadRow(thread: ThreadRow): string {
  const id = chalk.cyan(thread.threadId);
  const done = thread.isDone ? chalk.dim(" done") : "";

  if (thread.kind) {
    const children = thread.childCount ?? 0;
    return `${id} ${thread.title} ${chalk.dim(`[${thread.kind} ${children} ${children === 1 ? "child" : "children"} ${thread.aggregateStatus ?? "-"}]`)}${done}`;
  }

  const target = `${thread.profileName ?? "Unknown"}${thread.targetOnline ? "" : " offline"}`;
  return `${id} ${thread.title} ${chalk.dim(`[${thread.status ?? "-"} ${thread.cliType ?? "-"} ${target}]`)}${done}`;
}
