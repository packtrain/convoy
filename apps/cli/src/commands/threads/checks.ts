import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";

/** The fields this command reads from `checks.checklists.getForThread`. */
interface TaskCheck {
  key: string;
  label: string;
  instruction: string;
  added: boolean;
  results: { status: string; note?: string; value?: string; artifactId?: string }[];
}

/** The Checks that apply to a thread's task, or to a thread with no task, so an agent asked to "run the checks" can find them (docs/specs/task-checks.md). */
export const listThreadChecksCommand = addGlobalOptions(
  addOutputOptions(
    new Command("checks")
      .description("List the checks that apply to a thread (its task's, or its own without one), with their current status")
      .argument("<threadId>", "Thread ID")
  )
).action(async (threadId: string, options: OutputOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client }) => {
    const thread = await client.query(api.cli.threads.summaries.getSummary, { threadId: parseId<"cliThreads">(threadId, "threadId") });
    if (!thread) {
      throw new Error("Thread not found or not accessible.");
    }
    const taskChecks: { checks: TaskCheck[] } | null = await client.query(api.checks.checklists.getForThread, {
      threadId: thread.threadId,
    });
    const checks = (taskChecks?.checks ?? []).map(({ key, label, instruction, added, results: [current] }) => ({
      key,
      label,
      instruction,
      added,
      status: current?.status ?? "pending",
      ...(current?.value ? { value: current.value } : {}),
      ...(current?.note ? { note: current.note } : {}),
      ...(current?.artifactId ? { artifactId: current.artifactId } : {}),
    }));

    printOutput(resolveOutputMode(options), { taskId: thread.associatedTaskId ?? null, checks }, (value) => {
      if (value.checks.length === 0) {
        console.log("No checks apply to this thread.");
        console.log();
        return;
      }
      for (const check of value.checks) {
        console.log(`${chalk.bold(check.key)}  ${check.label}  ${chalk.dim(`[${check.status.replace("_", " ")}]`)}${check.added ? chalk.dim(" (added)") : ""}`);
        if (check.instruction) console.log(`  ${check.instruction}`);
        if (check.value) console.log(`  Value: ${check.value}`);
        if (check.note) console.log(chalk.dim(`  Note: ${check.note}`));
        if (check.artifactId) console.log(chalk.dim(`  Artifact: ${check.artifactId}`));
      }
      console.log();
      console.log(chalk.dim("Report one with: convoy threads attach <thread> [file...] --check <key> --passed | --warning | --failed | --not-performed [--value <answer>] [--artifact <id>] --note <why>"));
      console.log();
    });
  });
});
