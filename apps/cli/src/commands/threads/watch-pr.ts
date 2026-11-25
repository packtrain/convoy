import chalk from "chalk";
import { Command } from "commander";
import type { FunctionReturnType } from "convex/server";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";

type WatchResult = FunctionReturnType<typeof api.integrations.github.pullRequestWatches.watch>;

function printChecks(title: string, checks: WatchResult["failingChecks"]) {
  if (checks.length === 0) return;
  console.log(title);
  for (const check of checks) console.log(`  - ${check.name}${check.url ? ` ${chalk.dim(check.url)}` : ""}`);
}

/** The state at the start: the watch reports only what changes after it. Spec: docs/specs/pull-request-watch.md. */
function printWatch(result: WatchResult) {
  console.log(chalk.green("✓") + ` ${result.alreadyWatching ? "Already watching" : "Watching"} ${result.pullRequest} ${chalk.dim(result.url)}`);
  console.log();
  console.log(`Head ${result.headSha.slice(0, 7)}`);
  printChecks("Failing checks:", result.failingChecks);
  printChecks("Running checks:", result.runningChecks);
  if (result.conflicts === true) console.log(`Conflicts with ${result.baseRef}.`);
  if (result.conflicts === null) console.log("GitHub is still checking for conflicts.");
  console.log();
  console.log(
    result.failingChecks.length > 0 || result.conflicts
      ? "Convoy reports only what changes from now on: fix what already fails, then end your turn."
      : "Convoy messages this thread when checks fail or pass, the branch conflicts, or someone else comments or reviews. End your turn now."
  );
  console.log();
}

export const watchPullRequestCommand = addGlobalOptions(
  addOutputOptions(
    new Command("watch-pr")
      .description("Watch the thread's pull request: Convoy messages the thread when its checks, conflicts, or comments change")
      .argument("<threadId>", "Thread ID")
      .argument("[pullRequest]", "github.com PR URL, or owner/repo#number; attached first when the thread has none")
  )
).action(async (threadId: string, pullRequest: string | undefined, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const result = await client.action(api.integrations.github.pullRequestWatches.watch, {
      threadId: parseId<"cliThreads">(threadId, "threadId"),
      ...(pullRequest === undefined ? {} : { pullRequest }),
    });
    printOutput(resolveOutputMode(options), result, () => printWatch(result));
  });
});
