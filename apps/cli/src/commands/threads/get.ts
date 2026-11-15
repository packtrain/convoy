import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { ThreadRow } from "./formatters.js";

export const getThreadCommand = addGlobalOptions(
  addOutputOptions(
    new Command("get")
      .description("Get a CLI thread, or a thread group's metadata")
      .argument("<threadId>", "Thread ID or thread group container ID")
  )
).action(async (threadId: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const outputMode = resolveOutputMode(options);
    const thread: ThreadRow | null = await client.query(api.cli.threads.summaries.getSummary, {
      threadId: parseId<"cliThreads">(threadId, "threadId"),
    });
    if (!thread) {
      throw new Error("Thread not found or not accessible.");
    }

    printOutput(outputMode, thread, (value) => {
      console.log(chalk.bold(`\n${value.title}`));
      console.log(`  ID: ${value.threadId}`);
      console.log(`  Done: ${value.isDone ? "yes" : "no"}`);
      console.log(`  Last activity: ${new Date(value.lastActivityAt).toISOString()}`);
      if (value.associatedTaskId) {
        console.log(`  Task: ${value.associatedTaskId}`);
      }

      // Two disjoint field sets discriminated by `kind`: a container has no
      // runtime target, so it prints group metadata instead of an invented one.
      // It carries no `parentThreadId` by construction (`toContainerSummary`) —
      // groups don't nest — so this branch drops nothing.
      if (value.kind) {
        console.log(`  Kind: ${value.kind}`);
        console.log(`  Children: ${value.childCount ?? 0}`);
        console.log(`  Group status: ${value.aggregateStatus ?? "-"}`);
        if (value.originThreadId) {
          console.log(`  Origin thread: ${value.originThreadId}`);
        }
        console.log();
        return;
      }

      console.log(`  Status: ${value.status ?? "-"}`);
      console.log(`  Runtime: ${value.cliType ?? "-"}`);
      console.log(`  Profile: ${value.profileName ?? "Unknown"} (${value.targetOnline ? "online" : "offline"})`);
      console.log(`  Path: ${value.path ?? "-"}`);
      console.log(`  Queue: ${value.hasPendingUserMessages ? "pending messages" : "empty"}${value.queueHeldAt ? " (held)" : ""}`);
      if (value.parentThreadId) {
        console.log(`  Group: ${value.parentThreadId}`);
      }
      console.log();
    });
  });
});
