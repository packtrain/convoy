import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";

export const attachPullRequestToThreadCommand = addGlobalOptions(
  addOutputOptions(
    new Command("attach-pr")
      .description("Attach a GitHub pull request to a thread that has none")
      .argument("<threadId>", "Thread ID")
      .argument("<pullRequest>", "github.com PR URL, or owner/repo#number")
  )
).action(async (threadId: string, pullRequest: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const parsedThreadId = parseId<"cliThreads">(threadId, "threadId");
    await client.mutation(api.cli.threads.core.attachPullRequest, { threadId: parsedThreadId, pullRequest });
    printOutput(resolveOutputMode(options), { threadId: parsedThreadId, pullRequest }, () => {
      console.log(chalk.green("✓") + " Pull request attached to thread");
      console.log();
    });
  });
});
