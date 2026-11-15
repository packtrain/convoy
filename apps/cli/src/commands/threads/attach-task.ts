import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { requireThreadProject } from "../../lib/thread-attachments.js";
import { parseScopedTaskRef } from "../tasks/parsers.js";
import { resolveTaskIdOrRef } from "../tasks/resolve.js";

export const attachTaskToThreadCommand = addGlobalOptions(
  addOutputOptions(
    new Command("attach-task")
      .description("Attach a task to a thread started without one")
      .argument("<threadId>", "Thread ID")
      .argument("<task>", "Task ID or ref, resolved in the thread's project")
  )
).action(async (threadId: string, task: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const parsedThreadId = parseId<"cliThreads">(threadId, "threadId");
    if (parseScopedTaskRef(task)) {
      throw new Error("Pass a bare ref like OS-5: the task must be in the thread's project.");
    }
    // The thread's project, not the configured default, so a bare ref cannot hit another project.
    const projectId = await requireThreadProject(client, parsedThreadId);
    const taskId = await resolveTaskIdOrRef(client, { value: task, label: "task", projectId });
    await client.mutation(api.cli.threads.core.attachTask, { threadId: parsedThreadId, taskId });
    printOutput(resolveOutputMode(options), { threadId: parsedThreadId, taskId }, () => {
      console.log(chalk.green("✓") + " Task attached to thread");
      console.log();
    });
  });
});
