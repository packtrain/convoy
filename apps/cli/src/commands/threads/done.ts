import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";

export const markThreadDoneCommand = addGlobalOptions(
  addOutputOptions(
    new Command("done")
      .description("Mark a settled thread as done and read; rejects running group members")
      .argument("<threadId>", "Thread ID")
  )
).action(async (threadId: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const parsedThreadId = parseId<"cliThreads">(threadId, "threadId");
    await client.mutation(api.cli.threads.core.markDone, { threadId: parsedThreadId });
    printOutput(resolveOutputMode(options), { threadId: parsedThreadId }, () => {
      console.log(chalk.green("✓") + " Thread marked done");
      console.log();
    });
  });
});
