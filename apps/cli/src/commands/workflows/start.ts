import chalk from "chalk";
import { Command } from "commander";
import { addGlobalOptions } from "../../cli.js";
import { api } from "../../convex/_generated/api.js";
import { parseId } from "../../lib/id.js";
import { runOneShotCommand } from "../../lib/one-shot-command.js";
import { addOutputOptions, printOutput, resolveOutputMode, type OutputOptions } from "../../lib/output.js";
import { resolveAbsentableStringInput } from "../../lib/text-input.js";
import { resolveTaskIdForCommand } from "../tasks/resolve.js";

interface StartWorkflowOptions extends OutputOptions {
  org?: string;
  profileId?: string;
  pathId?: string;
  worktreeBranch?: string;
  worktreeBase?: string;
  task?: string;
  pullRequest?: string;
  firstPrompt?: string;
  firstPromptFile?: string;
}

function requireFlag<T>(value: T | undefined, flag: string): T {
  if (value === undefined) {
    throw new Error(`--${flag} is required.`);
  }
  return value;
}

// Runtime/model/mode come from the pinned definition (docs/specs/workflows.md →
// Start), so unlike `threads create` there is no --cli-type here.
export const startWorkflowCommand = addGlobalOptions(
  addOutputOptions(
    new Command("start")
      .description("Start a Workflow run")
      .argument("<workflowId>", "Workflow to run")
      .option("--profile-id <profileId>", "CLI profile to run on (see `profiles list`)")
      .option("--path-id <pathId>", "Working path on that profile")
      .option("--worktree-branch <branch>", "Run in a new worktree on this branch, created from the path")
      .option("--worktree-base <ref>", "Base ref for the new worktree branch")
      .option("--task <taskId>", "Attach a task (ID or ref)")
      .option("--pull-request <pr>", "Attach a GitHub pull request (URL or owner/name#number)")
      .option("--first-prompt <text>", "Override the first lane's first prompt for this run only")
      .option("--first-prompt-file <path>", "Read the first-prompt override from a file")
      .option("--org <org>", "Organization ID or slug (used with --project alias)")
  )
).action(async (workflow: string, options: StartWorkflowOptions, cmd: Command) => {
  await runOneShotCommand(cmd, async ({ client, config }) => {
    const outputMode = resolveOutputMode(options);
    const pathId = requireFlag(options.pathId, "path-id");
    if (options.worktreeBase !== undefined && options.worktreeBranch === undefined) {
      throw new Error("--worktree-base needs --worktree-branch.");
    }
    const firstPrompt = resolveAbsentableStringInput({
      inlineValue: options.firstPrompt,
      filePath: options.firstPromptFile,
      inlineLabel: "--first-prompt",
      fileLabel: "--first-prompt-file",
      displayName: "first prompt",
    })?.trim();
    const taskId = options.task
      ? await resolveTaskIdForCommand({ client, config, cmd, taskIdOrRef: options.task, org: options.org })
      : undefined;

    const result = await client.mutation(api.workflows.runs.core.start, {
      workflowId: parseId<"workflows">(workflow, "workflowId"),
      profileId: parseId<"cliProfiles">(requireFlag(options.profileId, "profile-id"), "profileId"),
      pathId,
      ...(options.worktreeBranch !== undefined && {
        worktree: {
          parentPathId: pathId,
          branch: options.worktreeBranch,
          ...(options.worktreeBase !== undefined && { baseRef: options.worktreeBase }),
        },
      }),
      ...(taskId !== undefined && { taskId }),
      ...(options.pullRequest !== undefined && { pullRequestUrl: options.pullRequest }),
      ...(firstPrompt && { firstPromptOverride: { displayContent: firstPrompt } }),
    });

    printOutput(outputMode, result, (value) => {
      console.log(chalk.green("✓") + " Workflow run started");
      console.log(`  Run: ${value.runId}`);
      console.log(`  Thread: ${value.containerThreadId}`);
      console.log();
    });
  });
});
