import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";

export const unwatchPullRequestCommand = addGlobalOptions(
  addOutputOptions(
    new Command("unwatch-pr")
      .description("Stop watching the thread's pull request; it stays attached")
      .argument("<threadId>", "Thread ID")
  )
).action(async (threadId: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const parsedThreadId = parseId<"cliThreads">(threadId, "threadId");
    await client.mutation(api.integrations.github.pullRequestWatches.unwatch, { threadId: parsedThreadId });
    printOutput(resolveOutputMode(options), { threadId: parsedThreadId }, () => {
      console.log(chalk.green("✓") + " Stopped watching the pull request");
      console.log();
    });
  });
});
