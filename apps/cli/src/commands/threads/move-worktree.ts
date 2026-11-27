import chalk from "chalk";
import { Command } from "commander";
import { resolve } from "node:path";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { inspectWorktreeMoveTarget } from "../../lib/git/worktrees.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";

/** After moving a thread's work into a worktree, its next run starts there. Spec: docs/specs/cli-worktrees.md#agent-driven-worktree-move. */
export const moveWorktreeCommand = addGlobalOptions(
  addOutputOptions(
    new Command("move-worktree")
      .description("Start the thread's next run in a worktree of its repository on this machine")
      .argument("<threadId>", "Thread ID")
      .argument("<path>", "Worktree path")
  )
).action(async (threadId: string, path: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const parsedThreadId = parseId<"cliThreads">(threadId, "threadId");
    const thread = await client.query(api.cli.threads.summaries.getSummary, { threadId: parsedThreadId });
    if (!thread) throw new Error("Thread not found or not accessible.");
    if (!thread.path) throw new Error("Groups and workflow runs have no working directory.");
    const target = await inspectWorktreeMoveTarget(thread.path, resolve(path));
    await client.mutation(api.cli.worktrees.moveThread, { threadId: parsedThreadId, ...target });
    printOutput(resolveOutputMode(options), { threadId: parsedThreadId, path: target.path, branch: target.branch }, () => {
      console.log(chalk.green("✓") + ` The thread's next run starts in ${target.path} on ${target.branch}`);
      console.log("This run stays in its current directory.");
      console.log();
    });
  });
});
